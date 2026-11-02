# Documentation map

These guides explain the **local distribution** in this repository. They describe current behavior and its limits. Proposal pages are grouped separately; release verification and licensing are maintenance records rather than feature guides.

## Start here

- [Step-by-step installation](../README.md#local-installation): dependencies, model downloads, avatar, native engine and first generation.
- [Your first animation](GETTING_STARTED.md): which buttons to use, what should happen and how to save/export.
- [Troubleshooting](TROUBLESHOOTING.md): find the first failed step without reinstalling everything.
- [Models and runtimes](MODELS_AND_RUNTIMES.md): required files, download commands and CPU/GPU boundaries.
- [Technical overview](TECHNICAL_REFERENCE.md): components and processing boundaries.
- [User guide](documentation-site.md): local /docs page and online help.

For a first attempt, read installation and Your first animation only. The processing-internals pages below are optional explanations for readers who want to understand how it works. Proposal pages are not setup steps.

## Creating and editing motion

- [Text generation](text-retarget-review.md)
- [Image pose references](image-pose-references.md)
- [Video preparation](video-preparation-pro-sdpose.md)
- [Video tracking review](video-review-workspace.md)
- [Pro model pipeline](pro-capture-pipeline.md)
- [Video-conditioned generation](video-hybrid-retarget.md)
- [Clips, layers and export](nla-editor.md)
- [Wallet-avatar preview](custom-avatar.md)

## Processing internals

- [Retargeting, root transforms and IK](retargeting-pipeline.md)
- [Hand fitting and captured root movement](somahand-source-motion.md)
- [Reference measurements and calibration](emote-reference-library.md)
- [Interface behavior](ui-ux-standards.md)

## Proposals and inactive features

These pages do not document shipped features:

- [Custom ONNX corrector](custom-onnx-model.md)
- [Selective SDPose assistance](sdpose-selective-support.md)
- [Possible style templates](emote-style-templates.md)
- [Local installer](launch-and-installer-plan.md)
- [Creator Hub integration](creator-hub-roadmap.md)

## Release and licensing

- [Code, model and data licenses](LICENSING.md)
- [Source preparation and actual validation](GIT_PREPARATION.md)
- [Third-party provenance](../THIRD_PARTY.md)
- [Native engine build/protocol](../native/kimodo/README.md)

Try the separate [hosted beta](https://dclmotionstudio.xyz/app) or read the [online user guide](https://dclmotionstudio.xyz/docs). Hosted availability and processing differ from the local version.
