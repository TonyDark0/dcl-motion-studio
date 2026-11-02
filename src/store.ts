import { getPreferences, setLocale, subscribePreferences, type Locale } from './preferences';
import { create } from 'zustand';
import type { CustomAvatar } from './custom-avatar-types';
import {
  newProject,
  controlsAt,
  defaults,
  type Project,
  type Controls,
  type HandPose,
} from './motion';
import {
  newTimeline,
  newStrip,
  sourceFromProject,
  sourceFields,
  timelineDuration,
  stripEnd,
  emoteTimeline,
  MAX_TIMELINE_SECONDS,
} from './timeline';
type Store = {
  customAvatar: CustomAvatar | null;
  avatarLoading: boolean;
  avatarError: string;
  locale: Locale;
  project: Project;
  preview: Project | null;
  previewJobId: string | null;
  previewTime: number;
  previewPlaying: boolean;
  addHands: (patch: Partial<Project>) => void;
  addHandTemplate: (pose: HandPose) => void;
  stage: (patch: Partial<Project>, jobId?: string) => void;
  acceptPreview: () => void;
  discardPreview: () => void;
  time: number;
  playing: boolean;
  skeleton: boolean;
  handles: boolean;
  selected: 'LeftFoot' | 'RightFoot' | 'LeftHand' | 'RightHand';
  past: Project[];
  future: Project[];
  message: string;
  selectedStrip: string | null;
  selectStrip: (id: string) => void;
  setLocale: (locale: Locale) => void;
  setTime: (t: number) => void;
  set: (patch: Partial<Store>) => void;
  change: (p: Partial<Project>) => void;
  control: (patch: Partial<Controls>) => void;
  load: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  key: () => void;
};
const initial = newProject();
initial.timeline = { ...newTimeline(initial), assets: [], strips: [], tracks: [] };
function withTimeline(p: Project) {
  const timeline = emoteTimeline(p.timeline || newTimeline(p));
  return { ...p, timeline, duration: timelineDuration(timeline) };
}
function focusSource(project: Project, id: string | null) {
  const tl = project.timeline,
    strip = tl?.strips.find((s) => s.id === id) || tl?.strips[0];
  const asset = tl?.assets.find((a) => a.id === strip?.assetId);
  const fields = asset
    ? Object.fromEntries(sourceFields.map((k) => [k, asset[k]]))
    : tl
      ? {
          preset: 'idle' as const,
          motion: null,
          handMode: 'none' as const,
          handReference: null,
        }
      : {};
  return { project: { ...project, ...fields }, selectedStrip: strip?.id || null };
}
export const useStudio = create<Store>((set, get) => ({
  customAvatar: null,
  avatarLoading: false,
  avatarError: '',
  locale: getPreferences().locale,
  project: initial,
  preview: null,
  previewJobId: null,
  previewTime: 0,
  previewPlaying: false,
  addHandTemplate: (pose) => {
    const state = get(),
      tl = state.project.timeline!;
    if (tl.assets.length >= 32 || tl.strips.length >= 64 || tl.tracks.length >= 64) return;
    const asset = sourceFromProject({
      ...state.project,
      preset: 'idle',
      motion: null,
      handMode: 'procedural',
      handPoseStart: pose,
      handPoseEnd: pose,
      handReference: null,
      handWristInfluence: 0,
      duration: timelineDuration(tl),
      videoResult: null,
      smoothing: 0,
    });
    asset.name = pose[0].toUpperCase() + pose.slice(1);
    const track = {
      id: crypto.randomUUID(),
      name: 'Hands',
      kind: 'hands' as const,
      muted: false,
      solo: false,
      locked: false,
    };
    const strip = { ...newStrip(asset, track.id, 0), mask: 'fingers' as const, alignRoot: false };
    state.change({
      timeline: {
        ...tl,
        assets: [...tl.assets, asset],
        tracks: [...tl.tracks, track],
        strips: [...tl.strips, strip],
      },
    });
    get().selectStrip(strip.id);
  },
  addHands: (patch) => {
    const state = get(),
      tl = state.project.timeline!;
    const body = tl.strips.find((x) => x.id === state.selectedStrip);
    if (!body || tl.assets.length >= 32 || tl.strips.length >= 64 || tl.tracks.length >= 64) return;
    const asset = sourceFromProject({ ...state.project, ...patch });
    asset.name = 'Hands · ' + asset.name;
    const track = {
      id: crypto.randomUUID(),
      name: 'Hands',
      kind: 'hands' as const,
      muted: false,
      solo: false,
      locked: false,
    };
    const strip = {
      ...body,
      id: crypto.randomUUID(),
      assetId: asset.id,
      trackId: track.id,
      mask: 'hands' as const,
      blend: 'replace' as const,
      alignRoot: false,
    };
    get().change({
      timeline: {
        ...tl,
        tracks: [...tl.tracks, track],
        assets: [...tl.assets, asset],
        strips: [...tl.strips, strip],
      },
    });
    get().selectStrip(strip.id);
  },
  stage: (patch, jobId) => {
    const preview: Project = { ...get().project, ...patch, timeline: null };
    preview.timeline = newTimeline(preview);
    set({
      preview,
      previewJobId: jobId ?? null,
      previewTime: 0,
      previewPlaying: true,
      playing: false,
    });
  },
  acceptPreview: () => {
    const preview = get().preview;
    if (!preview) return;
    const previousTimeline = get().project.timeline;
    get().change({
      ...Object.fromEntries(sourceFields.map((key) => [key, preview[key]])),
      preset: preview.preset,
      duration: preview.duration,
      workflow: preview.workflow,
      controls: preview.controls,
      keyframes: preview.keyframes,
    });
    if (get().project.timeline === previousTimeline) return;
    const selected = get().project.timeline?.strips.find(
      (strip) => strip.id === get().selectedStrip,
    );
    set({
      preview: null,
      previewJobId: null,
      previewPlaying: false,
      time: selected?.start ?? 0,
      playing: true,
    });
  },
  discardPreview: () =>
    set({ preview: null, previewJobId: null, previewPlaying: false, playing: false }),
  selectedStrip: null,
  selectStrip: (id) => {
    const state = get();
    if (!state.project.timeline?.strips.some((s) => s.id === id)) return;
    set(focusSource(state.project, id));
  },
  time: 0,
  playing: false,
  skeleton: false,
  handles: true,
  selected: 'LeftFoot',
  past: [],
  future: [],
  message: '',
  setLocale,
  setTime: (time) => set({ time }),
  set: (patch) => {
    if (patch.playing && !get().project.timeline?.strips.length) {
      set({ ...patch, playing: false, time: 0 });
    } else set(patch);
  },
  change: (patch) => {
    const s = get();
    let project = { ...s.project, ...patch },
      selectedStrip = s.selectedStrip;
    const tl = s.project.timeline;
    if (tl && patch.preset !== undefined && !('timeline' in patch)) {
      // Generation and accepted capture add sources; they never destroy the edit.
      const asset = sourceFromProject(project);
      const starter =
        tl.strips.length === 0 ||
        (tl.strips.length === 1 &&
          tl.strips[0].assetId === 'starter' &&
          !s.project.keyframes.length &&
          JSON.stringify(s.project.controls) === JSON.stringify(defaults));
      if (starter) {
        project.timeline = newTimeline(project);
        selectedStrip = project.timeline.strips[0].id;
      } else {
        if (tl.assets.length >= 32 || tl.strips.length >= 64 || tl.tracks.length >= 64) {
          set({ message: 'Remove unused clips before adding another animation.' });
          return;
        }
        const track = {
          id: crypto.randomUUID(),
          name: 'Body',
          kind: 'body' as const,
          muted: false,
          solo: false,
          locked: false,
        };
        const strip = newStrip(asset, track.id, 0);
        project.timeline = {
          ...tl,
          tracks: [...tl.tracks, track],
          assets: [...tl.assets, asset],
          strips: [...tl.strips, strip],
        };
        selectedStrip = strip.id;
        // Existing pose corrections belong to timeline time, not to the new source.
        project.controls = { ...s.project.controls, ground: false };
        project.keyframes = s.project.keyframes.map((key) => ({
          ...key,
          controls: { ...key.controls, ground: false },
        }));
      }
      project.duration = timelineDuration(project.timeline);
      project.timeline = {
        ...project.timeline,
        rangeEnd:
          starter || Math.abs(tl.rangeEnd - s.project.duration) < 1e-6
            ? project.duration
            : tl.rangeEnd,
      };
    } else if (tl && !('timeline' in patch) && sourceFields.some((k) => k in patch)) {
      const strip = tl.strips.find((x) => x.id === selectedStrip);
      if (strip && tl.tracks.find((t) => t.id === strip.trackId)?.locked) return;
      if (strip)
        project.timeline = {
          ...tl,
          assets: tl.assets.map((a) =>
            a.id === strip.assetId
              ? {
                  ...a,
                  ...Object.fromEntries(
                    sourceFields.filter((k) => k in patch).map((k) => [k, patch[k]]),
                  ),
                }
              : a,
          ),
        };
    }
    if (project.timeline) {
      const duration = timelineDuration(project.timeline);
      if (!Number.isFinite(duration) || duration > MAX_TIMELINE_SECONDS + 1e-6) {
        set({ message: 'The timeline limit is 10 seconds.' });
        return;
      }
      project.duration = duration;
      project.timeline = emoteTimeline(project.timeline);
    }
    set({
      ...focusSource(project, selectedStrip),
      time: project.timeline?.strips.length ? Math.min(s.time, project.duration) : 0,
      playing: !!project.timeline?.strips.length && s.playing,
      past: [...s.past, s.project].slice(-40),
      future: [],
    });
  },
  control: (patch) => {
    const s = get(),
      controls = { ...controlsAt(s.project, s.time), ...patch };
    const keyframes = s.project.keyframes.length
      ? [
          ...s.project.keyframes.filter((k) => Math.abs(k.time - s.time) > 1 / 60),
          { time: Math.round(s.time * 30) / 30, controls },
        ].sort((a, b) => a.time - b.time)
      : [];
    s.change({ controls, keyframes });
  },
  load: (project) => {
    const p = withTimeline(project);
    set({
      ...focusSource(p, null),
      preview: null,
      previewJobId: null,
      previewPlaying: false,
      time: 0,
      playing: false,
      past: [],
      future: [],
    });
  },
  undo: () => {
    const s = get();
    if (!s.past.length) return;
    const project = s.past.at(-1)!;
    set({
      ...focusSource(project, s.selectedStrip),
      time: project.timeline?.strips.length ? Math.min(s.time, project.duration) : 0,
      playing: !!project.timeline?.strips.length && s.playing,
      past: s.past.slice(0, -1),
      future: [s.project, ...s.future],
    });
  },
  redo: () => {
    const s = get();
    if (!s.future.length) return;
    set({
      ...focusSource(s.future[0], s.selectedStrip),
      time: s.future[0].timeline?.strips.length ? Math.min(s.time, s.future[0].duration) : 0,
      playing: !!s.future[0].timeline?.strips.length && s.playing,
      past: [...s.past, s.project],
      future: s.future.slice(1),
    });
  },
  key: () => {
    const s = get(),
      time = Math.round(s.time * 30) / 30;
    s.change({
      keyframes: [
        ...s.project.keyframes.filter((k) => Math.abs(k.time - time) > 1 / 60),
        { time, controls: controlsAt(s.project, time) },
      ].sort((a, b) => a.time - b.time),
    });
  },
}));

subscribePreferences(() => useStudio.setState({ locale: getPreferences().locale }));
