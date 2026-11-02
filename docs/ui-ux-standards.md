# Editor interface and interaction model

Studio uses React, Zustand, Three.js, Decentraland UI2 3.23.3 and MUI components. Shared theme tokens provide the surrounding surfaces and controls; spatial editing remains implemented by the viewport and timeline.

## Workspaces and state

Projects organize text/video creation and retain the avatar, sources, timeline and controls. The header provides project navigation, save, settings and export as appropriate to the active view. Leaving a dirty project requests save/discard/cancel. Failed saves keep edits available.

The creation panels share one evaluated animation state. The video review retains its observations until accepted or deliberately replaced. Timeline and avatar-control panels can be collapsed without discarding their contents.

## Viewport and controls

Camera presets, orbit controls, colors, skeleton display, IK handles and root-motion selection operate on the local preview. Custom color and spatial widgets use the same theme but have specialized pointer interactions. Saved serializable project state is distinct from transient Three.js objects and drag previews.

Text generation begins with the prompt. Seed reuse is exposed as **Keep style** after a completed generation; the numerical seed remains part of the motion metadata. That control is not a style-category model.

## Accessibility and input

Dialogs use labels, focus management and keyboard dismissal. Playback shortcuts avoid active text fields and modal interactions. The interface includes visible focus and reduced-motion handling. Dense timeline controls need different sizing from large creation actions.

These measures are not a claim of complete accessibility certification. Screen-reader behavior, contrast and touch interaction require continued testing across the actual editor surfaces.

## Settings and local boundaries

Settings expose language/theme preferences, avatar appearance and the local Kimodo configuration. The 3D stage uses a dark environment for legibility in either UI theme. No account, analytics, campaign quota or remote generation adapter is required by this distribution.

Implementation: [UI theme](../src/ui.tsx), [application shell](../src/App.tsx), [viewport](../src/Viewport.tsx), [timeline](../src/TimelineEditor.tsx) and [preferences](../src/preferences.ts).
