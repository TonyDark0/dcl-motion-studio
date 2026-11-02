# Previewing a wallet avatar

Settings → Custom avatar accepts a public Ethereum address and loads the corresponding Decentraland appearance. No wallet connection, signature or transaction is required. This optional feature contacts Decentraland's public services; core generation continues to run locally.

## Resolving the appearance

The local service reads the public Catalyst profile, resolves equipped wearable pointers, selects the applicable body-shape representations and proxies content by known hashes. NFT instance pointers are normalized to collection-item pointers where required.

Wearable categories, hiding/replacement rules, force-render choices and available base items determine the assembled appearance. Skin/hair colors and facial materials are applied in the preview. Unavailable or unsupported content produces a visible error or warning; a failed load does not replace a working preview with a partially assumed avatar.

## Applying animation

Each wearable retains its authored skin and inverse bind matrices. Preview binding transfers the canonical animation's world-space deltas to the appearance skeleton rather than replacing its proportions or renaming its joints in place. Original glTF node associations distinguish skin joints when a loader introduces name suffixes.

The personalized appearance is separate from the canonical export rig. Additional spring bones retain their reference poses; this feature does not include a spring-bone physics simulation.

## What is saved and exported

The selected wallet appearance is session-only. Project data retains the canonical animation and default avatar settings rather than embedding the wallet's wardrobe.

- **Export emote** bakes the canonical skeleton and skin declaration.
- **Export GLB** includes the tool's default avatar with the evaluated animation.
- Neither export includes the wallet's wearable hierarchy or wallet identifier.

The project's base `public/assets/Avatar.glb` is included in the repository and source ZIP. Keep it in place: loading a wallet avatar changes visualization only and does not replace the processing/export rig or turn the application into a universal rig importer. See [local installation](../README.md#local-installation) and [retargeting](retargeting-pipeline.md).

## Implementation

[Local resolver](../server/custom-avatar.ts), [preview settings](../src/CustomAvatarSettings.tsx) and the [viewport](../src/Viewport.tsx) handle the flow. Rights to view publicly available wearables do not automatically grant redistribution or training rights; see [licensing](LICENSING.md).
