# Local distribution and installer proposal

**Current delivery:** a source repository, not a standalone installer. Users install Node dependencies, supply the compatible DCL avatar, download models and configure a compiled native engine. See the step-by-step [local installation](../README.md#local-installation).

The hosted demo and its landing, Docker worker and provider infrastructure are a separate project. They are not prerequisites for this local distribution. This document does not specify a hosting budget, cloud deadline or deployment procedure.

## Proposed installer — not implemented

A future desktop installer could guide dependency checks, model downloads and native configuration. It would still need to distinguish application code from separately licensed model weights and user-provided resources.

A useful installation sequence would:

1. Check OS, CPU/GPU, available disk and runtime versions.
2. Explain local processing and obtain required provider access for optional models.
3. Download components from pinned sources and verify hashes.
4. Configure executable/library paths and run a capability check.
5. Open Studio with a first-run checklist and a clear uninstall/data-retention policy.

The installer must not bundle private credentials or restricted weights merely because the application code is Apache-2.0. OS support and GPU memory requirements would need validation on clean machines before being advertised.

This is a distribution design option, not a promise of an existing Windows executable or universal cross-platform support.
