# Local user guide and online documentation

The local application serves a separate guide at **/docs**. The root URL and /app open Studio. The guide explains projects, generation, tracking review, image references, smoothing, timeline controls, avatar preview, export and troubleshooting.

The [online documentation](https://dclmotionstudio.xyz/docs) accompanies the separately hosted beta. It can differ from the local distribution as either version evolves. Use this repository's [README](../README.md) for installation and the technical pages for the code included here. The [live demo](https://dclmotionstudio.xyz/app) is available subject to the beta campaign; it is not a local processing service.

## Content structure

- [documentation-content.ts](../src/documentation-content.ts): article content.
- [Documentation.tsx](../src/Documentation.tsx): searchable chapters, section navigation and article display.
- [documentation.css](../src/documentation.css): guide layout and responsive presentation.
- `public/docs/images/`: screenshots and teaching illustrations.

The guide is lazy-loaded separately from the editor. It supports chapter navigation, search, language preferences and enlarged images. It uses the same UI/theme framework as Studio.

## Maintaining the guide

Describe the controls and limits exposed by this distribution. Identify illustrations as illustrations, and use screenshots from the real interface for UI instructions. Keep model names, installation steps and local/remote processing claims aligned with source behavior.

Capture utilities are developer tools, not part of first installation. They require a running editor and suitable local example projects/media; those private inputs are not bundled. They should not be presented as commands that work on a fresh checkout without assets.

## Language editions

All language editions preserve paragraph, step, table and note structure. Translation uses individual source strings; when a translation is unavailable, that field keeps its current English text rather than replacing the section with a shortened or outdated summary. Complete source instructions remain available in every edition. Local documentation overrides live in src/locales/local-docs.json and are included by the translation build script.
