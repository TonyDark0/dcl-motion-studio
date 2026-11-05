# Local security review

Scope: the public source distribution, including its development server, local API and model installers. The hosted demo is a separate deployment and was not reviewed here. This is a preliminary threat model, not a penetration test or a security certification.

| Boundary | Existing controls | Residual risk / validation |
| --- | --- | --- |
| Browser → API | The API listens on 127.0.0.1:8787; Vite uses 127.0.0.1:5173. The API rejects unapproved Origin values when an Origin header is present. | Loopback is not authentication. Other local processes can call endpoints, including media preparation and engine configuration. Test browser-origin and Host handling (including DNS rebinding) separately. Do not forward these ports to untrusted networks. |
| Video input → FFprobe/FFmpeg | Stream to a generated temporary path; enforce a 256 MiB upload limit and 10-second segment limit; check source dimensions; spawn with argument arrays; restrict input protocols; limit concurrent conversions and apply a deadline. | Files reach the decoder under the same OS user. A timeout is not a memory quota or sandbox. Test supported containers, malformed/truncated media, resource-intensive frames, request cancellation, temporary disk use, and whether containers can reference other local files. |
| Frames → tracking | JSON size limits, exact dimensions for Fast raw input, bounded Pro base64 string, concurrent-frame guards and Pro timeout. | Compressed byte length does not bound decoded image size. Profile process memory and enforce decoded dimensions before expensive operations as needed. |
| Model files → native/Python engine | Basic and optional Pro installers verify pinned SHA-256 hashes before installing or reusing model files. | Verification is at install time; the user still trusts their local filesystem and executable configuration. Upstream code, Python dependencies, native binaries and decoders need their own review. |

The media regression tests exercise corrupt input rejection, oversized declared length rejection and successful preparation after rejection. They do not constitute decoder fuzzing or an adversarial resource-exhaustion test. The provisional trust boundary is the current OS account; multi-user isolation and public hosting are outside this local review.

## Dependency and model checks

On 5 November 2026, npm audit on the published lockfile flagged nine packages (two high, six moderate, one low); the production-only report flagged six. Updated the affected direct dependencies and refreshed their transitive dependencies without a forced audit fix. Both `npm audit` and `npm audit --omit=dev` reported zero known vulnerabilities after the update. A clean dependency install, the local build and all 169 tests passed. Rerun both audit scopes after changing the lockfile. An empty npm report only covers advisories known to that registry for the audited dependency tree. No cppcheck or native/Python dependency audit is implied.

The Pro manifest pins four files from the existing SAM 3D Body and MoGe revisions. For MoGe the local SHA-256 matched the published LFS object. For the large SAM files, the local SHA-256 and size reconstructed Git LFS pointers whose Git blob IDs matched the public tree at the pinned revision. The small YAML file matched its Git blob directly. This established the expected hashes without relying on trust in a newly downloaded checkpoint. The installer verifies bytes before replacing an installed file. A mismatch is reported and the staged copy is discarded. Re-run the model installer to check an existing installation.

## Independent installation milestone

Validate three clean environments: Windows 11, Windows 10 with the documented prerequisites, and a Linux VM. Include at least one machine other than the original development host. Linux is an evaluation target; document any portability work before calling it supported.

For each environment start from the same public commit, without cached model weights, engine binaries, node_modules or project configuration. Record OS, CPU/RAM and tool versions. Install the dependencies, build the native engine, install and verify the models, launch on loopback, generate a short text emote on CPU, and export and reopen its GLB. Run one Fast video example and record runtime, peak memory, blockers and fixes. Evaluate optional Pro separately on supported hardware. Publish a reproducible checklist and results. This milestone is pending; a fresh folder on the development machine is not an independent installation test.
