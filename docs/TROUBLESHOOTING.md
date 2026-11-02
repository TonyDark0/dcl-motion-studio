# Troubleshooting local installation and use

Identify the first failing step. Running the whole setup again is not necessary for every problem. Keep the terminal that runs Studio visible: it often contains the actual error behind a general message in the interface.

## Installation

| What you see                                             | What to check or do                                                                                                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node` or `npm` is not recognized                        | Install Node.js 24.x, reopen the terminal, then run the version commands again.                                                                                                                                                        |
| npm cannot find `package.json`                           | Open the terminal in the extracted project folder containing that file. Do not run commands inside the ZIP.                                                                                                                            |
| `npm ci` fails                                           | Read the first installation error. Check the Node version, connection and disk space. A partially created `node_modules` folder is not a successful installation.                                                                      |
| FFmpeg was installed but is still not found              | Reopen the terminal and return to the project folder. Run both `ffmpeg -version` and `ffprobe -version`.                                                                                                                               |
| FFmpeg is found but exits with an error or cannot encode | Verify that both installed tools run and FFmpeg includes `libx264`. Preserve the actual error/output. A working installation on another machine does not diagnose your local process failure. |
| A model download fails or its hash does not match        | Check the reported connection/disk error and rerun the relevant setup command. Do not skip hash verification or rename an unrelated weight file to satisfy the expected path.                                                          |
| The included `Avatar.glb` is missing                     | Restore `public/assets/Avatar.glb` from this repository or source ZIP. It is bundled; no separate avatar download or wallet connection is required.                                                                                    |
| The native engine does not start                         | Run its `--capabilities` command outside the editor. Check the compiler runtime/shared libraries and the [native build guide](../native/kimodo/README.md).                                                                             |

## Opening the editor

| What you see                                             | What to check or do                                                                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The browser cannot connect                               | Keep `npm run dev` running and open port 5173. If using `npm start`, open port 8787 instead. Closing the terminal stops the app.                                       |
| A port is already in use                                 | Check for another Studio instance. Close that instance with Ctrl+C before starting another; do not run development and production modes together on the same API port. |
| “Opening your local workspace” does not finish           | Inspect the API terminal for an error. Starting only the Vite frontend is insufficient; use `npm run dev` to start both frontend and API.                              |
| The avatar is missing or generation cannot read its file | Check `public/assets/Avatar.glb`, exact filename and compatibility. A file with the right extension but a different rig is not sufficient.                             |
| The page does not show source edits                      | With `npm start`, rebuild using `npm run build:local` before expecting frontend changes. Development mode uses Vite directly.                                          |

## Generation and tracking

| What you see                                                | What to check or do                                                                                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine configuration says files are missing                 | Check all three paths: executable, motion model and text encoder. Run the model setup if weights are absent.                                                                            |
| Constraints or video-conditioned generation are unavailable | Use the patched Studio Constraints engine. Its capabilities must report `soma30-v1` and protocol `C1`; an ordinary upstream executable is not equivalent.                               |
| “Configure the SOMA and text model paths first”             | Enter and save the two model paths in Configure before choosing Use Studio Constraints. Check installation tests the executable; it does not fill unsaved model fields.                 |
| Text generation runs slowly                                 | Start with a simple request and CPU mode. The first model load and processing time vary with hardware. There is no universal runtime guarantee.                                         |
| Pro is unavailable or reports a GPU/model access error      | Verify the optional Pro installation, compatible NVIDIA GPU and approved SAM model access. Use Fast while resolving Pro; do not reinstall the text engine.                              |
| Tracking reports a missing joint or unsuitable pose         | Inspect the indicated reference moment. Correct points or choose a clearer segment showing the complete person. Validation blocks unsuitable anchors before generation.                 |
| The final motion slides or does not match perfectly         | Inspect the tracking and generated animation separately. Use smoothing/IK/contact controls where appropriate. A valid request does not guarantee accurate or physically perfect motion. |
| A generation fails after review                             | Keep the reviewed reference, inspect the error and correct its cause before retrying. Runtime or memory failures can occur after a valid tracking check.                                |

## Saving and export

Save retains the editable local project; GLB export downloads a baked animation. If an export limit is exceeded, check the selected range and file-size message. Wallet wearables are preview-only and do not appear in the exported default-avatar file.

Back up the complete local `data/` folder while Studio is stopped, or keep project exports where the UI provides them. Do not delete `data/` as a generic troubleshooting step: it contains projects, reference files, configuration and downloaded models.

## Information to include when requesting help

Provide the OS, Node version, CPU/GPU, the command or button that failed, the exact error and whether the failure concerns text, Fast or Pro. Include relevant terminal lines. Remove access tokens, private paths or sensitive input before sharing logs. Do not upload your full `data/` folder as an error report.

The [release record](GIT_PREPARATION.md) lists checks actually performed. It does not certify a fresh installation on every machine.
