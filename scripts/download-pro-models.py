"""Install the pinned Pro files after checking their sizes and SHA-256 hashes."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path


MANIFEST = json.loads(Path(__file__).with_name("pro-models.json").read_text(encoding="utf-8"))


def matches(file: Path, expected: dict) -> bool:
    if not file.is_file() or file.stat().st_size != expected["size"]:
        return False
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == expected["sha256"]


def install_file(destination: Path, expected: dict, download) -> None:
    if matches(destination, expected):
        print(f"Verified existing: {destination.name}", flush=True)
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Verify the staged copy before exposing it to the inference runtime.
    with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".partial", delete=False) as stream:
        staged = Path(stream.name)
    try:
        for force in (False, True):
            shutil.copyfile(download(force), staged)
            if matches(staged, expected):
                staged.replace(destination)
                print(f"Installed and verified: {destination.name}", flush=True)
                return
        raise RuntimeError(f"SHA-256 or size mismatch for {destination.name}")
    finally:
        staged.unlink(missing_ok=True)


def main() -> int:
    root = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    model_root = root / "data" / "models" / "vision"
    sam = MANIFEST["sam"]
    sam_root = model_root / sam["directory"]
    sam_ready = all(matches(sam_root / name, entry) for name, entry in sam["files"].items())
    if "--check-sam" in sys.argv[2:]:
        return 0 if sam_ready else 1

    token = os.environ.get("HF_TOKEN")
    if not sam_ready and not token:
        print(
            "Missing or invalid SAM files. Obtain access at "
            "https://huggingface.co/facebook/sam-3d-body-dinov3 "
            "and rerun setup:pro:models with an authorized Hugging Face token.",
            file=sys.stderr,
        )
        return 2

    from huggingface_hub import hf_hub_download
    from huggingface_hub.errors import GatedRepoError, HfHubHTTPError

    try:
        for key, model in MANIFEST.items():
            if key == "sam" and sam_ready:
                print("Verified existing SAM 3D Body files.", flush=True)
                continue
            for filename, entry in model["files"].items():
                def download(force: bool) -> Path:
                    return Path(hf_hub_download(
                        repo_id=model["repo"],
                        filename=filename,
                        revision=model["revision"],
                        cache_dir=root / "data" / "hf-cache",
                        token=token if key == "sam" else False,
                        force_download=force,
                    ))

                install_file(model_root / model["directory"] / filename, entry, download)
    except (GatedRepoError, HfHubHTTPError):
        print("Hugging Face download failed. Check repository access and retry.", file=sys.stderr)
        return 2
    except (OSError, RuntimeError) as error:
        print(f"Pro setup failed: {error}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
