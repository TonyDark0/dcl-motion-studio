"""Persistent local inference worker for MoGe-2 ViT-S and SAM 3D Body.

The process speaks newline-delimited JSON on stdin/stdout. Model diagnostics are
redirected to stderr so the Node host can keep a strict response channel.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import gc
import json
import math
import os
import sys
import time
import traceback
from pathlib import Path

import cv2
import numpy as np
import torch


class Models:
    def __init__(self, root: Path):
        self.root = root
        self.runtime = root / "data" / "runtime" / "vision"
        self.models = root / "data" / "models" / "vision"
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.moge = None
        self.sam = None

    @property
    def sam_path(self):
        return self.models / "sam-3d-body-dinov3"

    @property
    def moge_path(self):
        return self.models / "moge-2-vits-normal" / "model.pt"

    def status(self):
        return {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "cuda": torch.cuda.is_available(),
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
            "samAvailable": (self.sam_path / "model.ckpt").exists()
            and (self.sam_path / "assets" / "mhr_model.pt").exists()
            and (self.sam_path / "model_config.yaml").exists()
            and (self.runtime / "vendor" / "sam-3d-body").exists(),
            "mogeAvailable": self.moge_path.exists()
            and (self.runtime / "vendor" / "MoGe").exists()
            and (self.runtime / "vendor" / "utils3d-moge").exists(),
            "samLoaded": self.sam is not None,
            "mogeLoaded": self.moge is not None,
        }

    def load_moge(self):
        if self.moge is not None:
            return self.moge
        # A second video's calibration must not load MoGe beside a resident SAM.
        if self.sam is not None:
            self.sam = None
            gc.collect()
            if self.device.type == "cuda":
                torch.cuda.empty_cache()
        if not self.status()["mogeAvailable"]:
            raise RuntimeError("MoGe-2 ViT-S is not installed. Run npm run setup:pro.")
        sys.path.insert(0, str(self.runtime / "vendor" / "utils3d-moge"))
        sys.path.insert(0, str(self.runtime / "vendor" / "MoGe"))
        from moge.model.v2 import MoGeModel

        with contextlib.redirect_stdout(sys.stderr):
            model = MoGeModel.from_pretrained(self.moge_path).to(self.device).eval()
        self.moge = model
        return model

    def load_sam(self):
        if self.device.type != "cuda":
            raise RuntimeError("SAM 3D Body Pro requires a CUDA GPU. Use Fast on CPU.")
        # Calibration is used once per video. Do not keep its dense depth
        # network resident beside SAM while processing every body frame.
        if self.moge is not None:
            self.moge = None
            gc.collect()
            if self.device.type == 'cuda':
                torch.cuda.empty_cache()
        if self.sam is not None:
            return self.sam
        if not self.status()["samAvailable"]:
            raise RuntimeError(
                "SAM 3D Body checkpoint is missing. Accept Meta's Hugging Face license and run npm run setup:pro."
            )
        source = self.runtime / "vendor" / "sam-3d-body"
        sys.path.insert(0, str(source))
        from sam_3d_body import SAM3DBodyEstimator, load_sam_3d_body

        with contextlib.redirect_stdout(sys.stderr):
            model, cfg = load_sam_3d_body(
                checkpoint_path=str(self.sam_path / "model.ckpt"),
                mhr_path=str(self.sam_path / "assets" / "mhr_model.pt"),
                device=str(self.device),
            )
            estimator = SAM3DBodyEstimator(model, cfg, human_detector=None, fov_estimator=None)
        self.sam = estimator
        return estimator

    @staticmethod
    def decode_image(encoded: str):
        payload = base64.b64decode(encoded)
        image = cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("Invalid JPEG frame")
        return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    def calibrate(self, encoded: str):
        image = self.decode_image(encoded)
        tensor = torch.from_numpy(np.ascontiguousarray(image)).permute(2, 0, 1).float().div_(255)
        model = self.load_moge()
        started = time.perf_counter()
        with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
            result = model.infer(tensor, resolution_level=4, use_fp16=self.device.type == "cuda", apply_mask=False)
        intrinsics = result["intrinsics"].detach().float().cpu().numpy()
        fx, fy = float(intrinsics[0, 0]), float(intrinsics[1, 1])
        fov_x = math.degrees(2 * math.atan(0.5 / max(fx, 1e-6)))
        fov_y = math.degrees(2 * math.atan(0.5 / max(fy, 1e-6)))
        return {
            "fovX": fov_x,
            "fovY": fov_y,
            "focalX": fx,
            "focalY": fy,
            "source": "moge-2-vits",
            "milliseconds": (time.perf_counter() - started) * 1000,
        }

    def sam_frame(self, encoded: str, bbox, calibration=None):
        image = self.decode_image(encoded)
        height, width = image.shape[:2]
        x, y, w, h = [float(n) for n in bbox]
        box = np.array([[max(0, x), max(0, y), min(width, x + w), min(height, y + h)]], dtype=np.float32)
        if not np.isfinite(box).all() or box[0, 2] - box[0, 0] < 2 or box[0, 3] - box[0, 1] < 2:
            raise ValueError('The person crop is outside the image or too small')
        cam_int = None
        if calibration:
            fx = float(calibration["focalX"]) * width
            fy = float(calibration["focalY"]) * height
            # SAM's estimator indexes camera intrinsics as [batch, row, column].
            # A plain 3x3 matrix reaches get_ray_condition() with one axis missing.
            cam_int = torch.tensor(
                [[[fx, 0.0, width / 2], [0.0, fy, height / 2], [0.0, 0.0, 1.0]]],
                dtype=torch.float32,
            )
        estimator = self.load_sam()
        started = time.perf_counter()
        with torch.inference_mode(), contextlib.redirect_stdout(sys.stderr):
            person = self.tracking_inference(estimator, image, box, cam_int)
        for field in ['pred_keypoints_2d', 'pred_keypoints_3d', 'focal_length', 'pred_cam_t']:
            if not np.isfinite(np.asarray(person[field])).all():
                raise ValueError(f'SAM returned non-finite {field}; retry this frame')
        keypoints2d = np.asarray(person["pred_keypoints_2d"], dtype=np.float32)[:70]
        inside = (
            (keypoints2d[:, 0] >= 0) & (keypoints2d[:, 0] < width)
            & (keypoints2d[:, 1] >= 0) & (keypoints2d[:, 1] < height)
        )
        score = float(np.clip(0.45 + inside.mean() * 0.5, 0.0, 0.95))
        normalized2d = keypoints2d.copy()
        normalized2d[:, 0] /= max(width, 1)
        normalized2d[:, 1] /= max(height, 1)
        return {
            "keypoints3d": np.asarray(person["pred_keypoints_3d"], dtype=np.float32)[:70].reshape(-1).tolist(),
            "keypoints2d": normalized2d.reshape(-1).tolist(),
            "score": score,
            "focalLength": float(np.asarray(person["focal_length"]).reshape(-1)[0]),
            "cameraTranslation": np.asarray(person["pred_cam_t"], dtype=np.float32).reshape(-1)[:3].tolist(),
            "milliseconds": (time.perf_counter() - started) * 1000,
        }

    def tracking_inference(self, estimator, image, box, cam_int):
        """Use upstream's complete decoder; retain only the tracking outputs.

        The visualization helper flushes CUDA's allocator on every frame and
        copies mesh vertices, skinning and expression tensors to the CPU. Those
        are unnecessary for this pipeline. Local tensors are freed normally;
        the allocator and model remain reusable for the next video frame.
        """
        from sam_3d_body.data.utils.prepare_batch import prepare_batch
        from sam_3d_body.utils import recursive_to

        batch = recursive_to(prepare_batch(image, estimator.transform, box, None, None), self.device)
        estimator.model._initialize_batch(batch)
        if cam_int is not None:
            batch["cam_int"] = cam_int.to(batch["img"]).clone()
        outputs = estimator.model.run_inference(
            image, batch, inference_type="full", transform_hand=estimator.transform_hand,
            thresh_wrist_angle=estimator.thresh_wrist_angle,
        )
        out = outputs[0]["mhr"]
        return {
            field: out[field][0].detach().float().cpu().numpy()
            for field in ("pred_keypoints_2d", "pred_keypoints_3d", "focal_length", "pred_cam_t")
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    args = parser.parse_args()
    models = Models(Path(args.root).resolve())
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            op = request.get("op")
            if op == "status":
                result = models.status()
            elif op == "calibrate":
                result = models.calibrate(request["jpeg"])
            elif op == "sam":
                result = models.sam_frame(request["jpeg"], request["bbox"], request.get("calibration"))
            elif op == "shutdown":
                break
            else:
                raise ValueError(f"Unknown operation: {op}")
            response = {"id": request.get("id"), "ok": True, "result": result}
            encoded_response = json.dumps(response, separators=(",", ":"), allow_nan=False)
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            if isinstance(exc, torch.cuda.OutOfMemoryError):
                gc.collect()
                torch.cuda.empty_cache()
            response = {"id": request.get("id") if "request" in locals() else None, "ok": False, "error": str(exc)}
            encoded_response = json.dumps(response, separators=(",", ":"), allow_nan=False)
        print(encoded_response, flush=True)


if __name__ == "__main__":
    main()
