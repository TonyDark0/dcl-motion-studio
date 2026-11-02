# Native constraints for Studio

This extension keeps the existing SOMA RP GGUF and quantized LLM2Vec text weights.
It does not install the official PyTorch inference stack or require cloud services.

## Build and activation

This is the developer step of local installation. npm does not compile this engine. You need Git, CMake, Ninja and a working C++23 compiler environment. On Windows, the compiler and its runtime libraries must match; mixing binaries from unrelated toolchains is not a supported setup. This source package does not include a prebuilt engine or a compiler installer.

If those tools are unfamiliar, get help with this step or use the hosted beta first. These commands do not install the toolchain.

### 1. Check the tools

Open the terminal in the Studio project root (the folder with package.json). In the compiler-configured terminal, check:

```sh
git --version
cmake --version
ninja --version
```

Each must print a version. Use CMake 3.25 or newer. Also confirm that your selected C++23 compiler is available through its configured environment. CMake must be able to detect it; the three version checks alone do not prove a compiler is installed.

### 2. Obtain the pinned engine source

The following commands use **PowerShell on Windows**. Run them once for a new source checkout. If that checkout already exists, inspect it rather than deleting or resetting it blindly.

```powershell
$studioRoot = (Get-Location).Path
$engineRoot = Join-Path $studioRoot 'data/build/kimodo.cpp'
$buildRoot = Join-Path $engineRoot 'build/studio'
$installRoot = Join-Path $studioRoot 'data/bin/kimodo-constraints'
New-Item -ItemType Directory -Force (Split-Path $engineRoot) | Out-Null
git clone https://github.com/localai-org/kimodo.cpp $engineRoot
git -C $engineRoot checkout 5679ff19ba0a522c0b0516e9a9d402fe1af2c027
git -C $engineRoot submodule update --init --recursive
git -C $engineRoot apply --check (Join-Path $studioRoot 'native/kimodo/constraints.patch')
git -C $engineRoot apply (Join-Path $studioRoot 'native/kimodo/constraints.patch')
```

Stop at any failed command. A failed patch check means the source revision or patch state needs inspection; it is not a warning to ignore. The upstream source and build outputs stay under ignored data/.

### 3. Configure and build for CPU

In the same terminal, with the variables above still defined:

```powershell
cmake -S $engineRoot -B $buildRoot -G Ninja -DCMAKE_BUILD_TYPE=Release -DKIMODO_BUILD_TESTS=OFF -DKIMODO_ENABLE_VULKAN=OFF -DGGML_VULKAN=OFF -DGGML_OPENMP=OFF
cmake --build $buildRoot --target kmd-generate
```

Expected: CMake configuration succeeds, then the kmd-generate executable is built. If CMake cannot find a compiler or rejects C++23 support, resolve the toolchain before continuing. Linux/macOS use the same source commit, patch and CMake options, with shell-appropriate paths; those platforms are not certified by this release preparation.

### 4. Place and check the executable

For a single-configuration Ninja Windows build, copy the executable and generated DLLs:

```powershell
New-Item -ItemType Directory -Force $installRoot | Out-Null
Copy-Item (Join-Path $buildRoot 'kmd-generate.exe') $installRoot
Get-ChildItem $buildRoot -Recurse -Filter '*.dll' | ForEach-Object { Copy-Item $_.FullName $installRoot }
& (Join-Path $installRoot 'kmd-generate.exe') --capabilities
```

The last command must succeed and report:

```json
{ "constraints": "soma30-v1", "protocol": "C1" }
```

Compiler-runtime DLLs can also be required. The copy command collects DLLs produced in the build tree; it does not install external compiler runtimes. If the binary does not launch, inspect its error and the runtime requirements of the toolchain that built it. Do not treat a file's presence as a successful capability check.

### 5. Connect it to Studio

Return to the Studio project root and start npm run dev. In Settings → Kimodo → Configure:

1. Enter the full executable path and the downloaded SOMA/text-model paths.
2. Select CPU and choose **Save configuration**.
3. Reopen Configure, use **Check installation**, then **Use Studio Constraints**.

Save the model paths before activation: the activation action retains those values. The automatic button checks data/bin/kimodo-constraints/kmd-generate.exe. For another platform, configure your actual executable directly.

The native capability check does not load the model weights. Complete the first text-generation check in [Your first animation](../../docs/GETTING_STARTED.md) to verify that stage as well.

### Build troubleshooting

| Result                             | Next step                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Git/CMake/Ninja not found          | Install/configure the missing tool and reopen the appropriate terminal.                                                   |
| CMake cannot identify a compiler   | Use the terminal/environment for your installed C++23 toolchain.                                                          |
| Patch does not apply               | Check the exact pinned commit and whether the patch was already applied.                                                  |
| kmd-generate exists but cannot run | Inspect missing runtime/shared-library errors and OS execution policy. Do not disable the policy as a generic workaround. |
| Capabilities do not include C1     | Check that you built and copied the patched source, not a different executable.                                           |
| Studio reports model paths missing | Download the models and save their full paths before activating the engine.                                               |

## Workflow

Without image references, **Loop animation** appends a cyclic-motion instruction and generates a
temporary reference clip. Its first SOMA30 pose supplies full-body position anchors
and hand/foot orientation anchors at both endpoints of a second generation.
In-place mode additionally constrains the smooth root's XZ path to zero at every
frame. Root height and natural pelvis movement are not globally frozen. Source
motion mode closes the endpoints but allows travel between them.

Both passes use one resident worker sequentially. Expect roughly two generation
passes, not half-cost inference; exact time and peak memory require benchmarking.
The reference clip is not added to history and is removed after the operation.
The final job retains the effective prompt, constraints, input tensors and output.

With accepted **Image poses**, the uploaded start pose replaces the temporary
reference pass. The fitted SOMA pose anchors both ends of a loop; a middle image
can anchor a chosen time. Nonloops require start and end images. This path uses
one conditioned native pass. See [image pose references](../../docs/image-pose-references.md).

Native constraints guide the denoiser; they are not a guarantee that decoded
endpoints or velocities match exactly. Studio applies its existing NLA seam blend
over eight frames to loop sources before the DCL contact/IK pass. New standalone
loop timelines also enable seamless contact handling. Editing, trimming, mixing
clips or applying manual controls can change the seam and requires review.

## API

`POST /api/jobs` retains `prompt`, `duration` (1–10 seconds at the API boundary), `seed` and `steps`. The editor can expose a narrower selection.
It adds `loop: boolean`, `rootMotion: "inPlace" | "source"`, and optional `constraints`.
Automatic loop and explicit constraints are mutually exclusive.
An optional `referencePoses` request accepts reviewed MediaPipe world landmarks
and can be combined with `loop`, but not raw explicit `constraints`.

Constraints are a list of SOMA30 `root2d`, `fullbody`, `end-effector`, `left-hand`,
`right-hand`, `left-foot`, or `right-foot` objects. Frame indices are zero-based.
Pose constraints accept local axis-angle rotations in radians (`[T,30,3]`) and root
positions in meters (`[T,3]`). Coordinates are Y-up. Root2D is `[X,Z]`; heading is a
unit `[cos,sin]` pair. Match the official constraint JSON field names used in
`server/kimodo-constraints.ts`. The first constrained smooth root must be at XZ zero.
Convert reference poses into SOMA30 space and proportions before submitting them;
raw DCL rotations or photo pixels are not interchangeable with these values.

The image workflow implements photo upload, pose review and A→B / A→B→A anchors
through MediaPipe-to-SOMA fitting. Inverse retargeting from manually edited DCL
poses to SOMA is not included.

## Verification and development tools

The capability check verifies the native protocol. A real generation additionally checks weight loading. Unit tests cover constraint representation, input validation and the reference bridge; see [the release record](../../docs/GIT_PREPARATION.md) for the tests actually run on this prepared distribution.

`python scripts/constraints-parity.py /path/to/official/kimodo` regenerates the parity fixture when its separate dependencies are available. `node --import tsx scripts/smoke-constraints.ts 30` runs a real local generation and writes a report under data/validation. These are developer checks, not mandatory first-use commands. They require installed weights/runtimes and can take significant processing time.

Conditioning guides motion; it does not guarantee an exact loop or physically correct contacts. Review the baked animation before publication.
