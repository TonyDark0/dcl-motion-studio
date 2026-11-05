# Models and runtimes

Follow [installation](../README.md#local-installation) in order. This page explains the files; it is not an extra installation path. Start with CPU text generation and Fast capture. Pro is optional.

## Required for text generation

| Component | Location | How to obtain it |
| --- | --- | --- |
| Native Kimodo engine | `data/bin/kimodo-constraints/kmd-generate.exe` on Windows, plus its shared libraries | Compile the pinned source and Studio patch using the [native guide](../native/kimodo/README.md). npm does not build it. |
| SOMA motion model | `data/models/kimodo/kimodo-soma-rp-v1.1-f32.gguf` (~1.13 GB) | `npm run setup:models` |
| Text encoder | `data/models/kimodo/Llama-3-Kimodo-Q4_K_M.gguf` (~5.06 GB) | Same command |
| Tokenizer | `data/models/kimodo/tokenizer.gguf` (~7.3 MB) | Same command; keep it beside the text encoder. |
| Base avatar and rig | `public/assets/Avatar.glb` | Already included. Wallet import is optional and only changes the preview. |

The text encoder converts the prompt into conditioning for the motion model. It is not a conversational chatbot or an external LLM API. Choose **CPU** in the engine configuration for the first check. CPU execution needs system RAM even when no GPU is used; the file sizes are not a measurement of peak memory. This release has no certified minimum RAM or universal VRAM requirement.

## Additional files for Fast video capture

| Component | Location | How to obtain it |
| --- | --- | --- |
| MediaPipe pose model | `public/models/pose_landmarker_full.task` | `npm run setup:public` |
| MediaPipe browser runtime | `public/mediapipe/` | Already included. |
| RTMW3D checkpoint (~369 MB) | `data/models/vision/rtmw3d.onnx` | Included in `npm run setup:models`. |
| ONNX Runtime | npm dependency | Installed by `npm ci`. |
| FFmpeg and FFprobe | System PATH, or paths configured in `.env` | `npm run setup:video`; see README. FFmpeg needs `libx264`. |

Fast capture supports CPU execution; Pro's Python/CUDA environment is not required. Tracking alone does not finish the animation: accepting a reviewed video still requires the configured Kimodo engine and generation models.

`setup:models` checks video tools before downloading its combined text/video model set. Run `setup:video` first, even if your first test will be a text prompt. The combined download is approximately **6.6 GB** in decimal units, plus the separate MediaPipe model. Keep extra free space for dependencies, native source/build outputs, temporary downloads and saved projects.

## Optional Pro capture on Windows

After the basic setup works, run `npm run setup:pro` from the project root. It requires Git, Winget when Python must be installed, Internet and a compatible NVIDIA GPU/driver for the CUDA runtime. If Python 3.11 is installed during setup, reopen the terminal and rerun the command as instructed.

- Python 3.11 environment: `data/runtime/vision/.venv/`.
- PyTorch 2.7.1 + CUDA 12.8 and torchvision 0.22.1; additional Python dependencies are installed by the script. Some dependencies use version ranges, so the complete Pro environment is not a fully frozen lockfile.
- Pinned SAM 3D Body, MoGe and utils3d source checkouts: `data/runtime/vision/vendor/`.
- MoGe-2 ViT-S checkpoint: `data/models/vision/moge-2-vits-normal/`, pinned to revision `26b477f41595707c5db6770294c0d1721e8ed4ed`.
- SAM 3D Body DINOv3: `data/models/vision/sam-3d-body-dinov3/`, requiring `model.ckpt`, `model_config.yaml` and `assets/mhr_model.pt` at revision `11aaa346c7204874a1cbafe3d39a979080b2c55a`.

SAM requires approved access to [the provider's model repository](https://huggingface.co/facebook/sam-3d-body-dinov3) and an authorized Hugging Face read token. The installer prompts without displaying its value. Do not put tokens into source files or commit them. Pro downloads additional large checkpoints beyond the basic 6.6 GB; cache and environment files also occupy disk space. `npm run setup:pro:models` only retries downloads after the runtime is installed.

See [Pro capture](pro-capture-pipeline.md) for processing details. A successful installation is not proof that a particular GPU can run every input without exhausting memory.

## Verification and offline use

The basic download scripts pin model revisions and check file sizes/SHA-256 where defined. Their exact URLs and hashes are in [setup-models.mjs](../scripts/setup-models.mjs) and [setup-public-assets.mjs](../scripts/setup-public-assets.mjs). Pro uses pinned provider revisions and its own [size and SHA-256 manifest](../scripts/pro-models.json). The installer checks both new and existing files. This is an installation check, not verification on every inference run.

1. Check the expected files exist and each setup command completed successfully.
2. Run the native engine with `--capabilities`; expect `constraints: soma30-v1` and `protocol: C1`.
3. Save executable/model paths and CPU in Studio's configuration before checking/activating the engine.
4. Follow [your first animation](GETTING_STARTED.md) to test actual model loading, generation, preview and export. A capability response alone does not load weights.

After all dependencies are installed, local generation does not need a paid API or cloud account. Optional wallet-avatar loading queries Decentraland and therefore needs Internet. Downloading models, obtaining gated-model access and using the hosted demo are separate online operations.

Application code, model weights and third-party assets have different licenses. Read [licensing](LICENSING.md); the application's Apache-2.0 license does not relicense these models or grant rights to arbitrary reference videos.
