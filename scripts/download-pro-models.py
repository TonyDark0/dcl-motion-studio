"""Download the two Pro capture checkpoints into the project's local data folder."""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download
from huggingface_hub.errors import GatedRepoError, HfHubHTTPError


def complete_sam(folder: Path) -> bool:
    return (
        (folder / "model.ckpt").exists()
        and (folder / "model_config.yaml").exists()
        and (folder / "assets" / "mhr_model.pt").exists()
    )


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    model_root = root / "data" / "models" / "vision"
    model_root.mkdir(parents=True, exist_ok=True)

    print("Downloading MoGe-2 ViT-S (public checkpoint)…", flush=True)
    snapshot_download(
        "Ruicheng/moge-2-vits-normal",
        revision="26b477f41595707c5db6770294c0d1721e8ed4ed",
        local_dir=model_root / "moge-2-vits-normal",
    )

    sam_dir = model_root / "sam-3d-body-dinov3"
    if complete_sam(sam_dir):
        print("SAM 3D Body is already installed.", flush=True)
        return 0

    token = os.environ.get("HF_TOKEN")
    if not token:
        print(
            "SAM 3D Body requires accepted access at "
            "https://huggingface.co/facebook/sam-3d-body-dinov3 and an HF_TOKEN environment variable.",
            file=sys.stderr,
        )
        return 2
    try:
        print("Downloading licensed SAM 3D Body checkpoint…", flush=True)
        # Hugging Face's local_dir staging name can exceed Windows MAX_PATH for
        # assets/mhr_model.pt under a deeply nested project directory. Its normal
        # cache stores blobs under shorter names. Copy completed files from there
        # into the model directory, and keep the already downloaded 2 GB checkpoint.
        cache_dir = root / "data" / "hf-cache"
        for filename in ("model_config.yaml", "model.ckpt", "assets/mhr_model.pt"):
            destination = sam_dir / filename
            if destination.is_file() and destination.stat().st_size > 0:
                print(f"Already present: {filename}", flush=True)
                continue
            cached = hf_hub_download(
                repo_id="facebook/sam-3d-body-dinov3",
                filename=filename,
                revision="11aaa346c7204874a1cbafe3d39a979080b2c55a",
                cache_dir=cache_dir,
                token=token,
            )
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(cached, destination)
    except (GatedRepoError, HfHubHTTPError) as exc:
        print(
            "Hugging Face rejected SAM 3D Body access. Confirm the account has accepted the model license "
            "and that HF_TOKEN belongs to that account.",
            file=sys.stderr,
        )
        print(str(exc), file=sys.stderr)
        return 2
    if not complete_sam(sam_dir):
        print("SAM 3D Body download completed without the required model files.", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
