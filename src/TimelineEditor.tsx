import { useEffect, useRef, useState } from 'react';
import { useStudio } from './store';
import { useT } from './i18n';
import { handPoseSchema, type Strip, type TimelineData } from './motion';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import LoopIcon from '@mui/icons-material/Loop';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import {
  snap,
  stripDuration,
  stripEnd,
  timelineDuration,
  MAX_TIMELINE_SECONDS,
  emoteTimeline,
} from './timeline';

type Drag = {
  id: string;
  origin: number;
  original: Strip;
  next: Strip;
  mode: 'move' | 'in' | 'out';
  width: number;
  scrollStart: number;
  pointerX: number;
};
export function Timeline({
  ready,
  onCollapse,
  collapsed = false,
  previewing = false,
}: {
  ready: boolean;
  onCollapse?: () => void;
  collapsed?: boolean;
  previewing?: boolean;
}) {
  const s = useStudio(),
    p = s.project,
    tl = p.timeline!,
    t = useT();
  const [handsAnchor, setHandsAnchor] = useState<HTMLElement | null>(null),
    [zoom, setZoom] = useState(1);
  const [dragView, setDragView] = useState<Strip | null>(null),
    drag = useRef<Drag | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const selected = tl?.strips.find((x) => x.id === s.selectedStrip);
  const asset = tl?.assets.find((a) => a.id === selected?.assetId);
  const handsLayer = tl?.tracks.find((x) => x.id === selected?.trackId)?.kind === 'hands';
  const locked = tl?.tracks.find((x) => x.id === selected?.trackId)?.locked;
  useEffect(() => {
    if (tl && !selected && tl.strips[0]) s.selectStrip(tl.strips[0].id);
  }, [tl, selected, s.selectStrip]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const d = drag.current,
        el = scroll.current;
      if (d && el) {
        const bounds = el.getBoundingClientRect();
        const speed =
          d.pointerX > bounds.right - 32
            ? Math.min(18, (d.pointerX - bounds.right + 32) / 2)
            : d.pointerX < bounds.left + 180
              ? -Math.min(18, (bounds.left + 180 - d.pointerX) / 2)
              : 0;
        if (speed) {
          const old = el.scrollLeft;
          el.scrollLeft += speed;
          if (el.scrollLeft !== old) moveDrag(d.pointerX);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tl]);
  if (!tl) return null;
  function commit(next: TimelineData) {
    const duration = timelineDuration(next);
    if (
      next.assets.length > 32 ||
      next.strips.length > 64 ||
      duration > MAX_TIMELINE_SECONDS + 1e-6
    ) {
      s.set({ message: t('The timeline limit is 10 seconds.') });
      return;
    }
    s.change({ timeline: emoteTimeline(next), duration });
  }

  function update(id: string, patch: Partial<Strip>) {
    const old = tl.strips.find((x) => x.id === id)!;
    if (tl.tracks.find((t) => t.id === old.trackId)?.locked) return;
    const isHands =
      tl.tracks.find((x) => x.id === (patch.trackId ?? old.trackId))?.kind === 'hands';
    const next = {
        ...old,
        ...patch,
        ...(isHands
          ? {
              blend: 'replace' as const,
              mask: (['hands', 'fingers', 'wrists'].includes(patch.mask ?? old.mask)
                ? (patch.mask ?? old.mask)
                : 'hands') as Strip['mask'],
            }
          : {}),
      },
      source = tl.assets.find((a) => a.id === old.assetId)!;
    if (
      !Object.values(next).every((x) => typeof x !== 'number' || Number.isFinite(x)) ||
      next.start < 0 ||
      next.in < 0 ||
      next.out > source.duration + 1e-6 ||
      next.out - next.in < 1 / 30 - 1e-6
    )
      return;
    commit({ ...tl, strips: tl.strips.map((x) => (x.id === id ? next : x)) });
  }
  function duplicate() {
    if (!selected || !asset || locked) return;
    if (tl.tracks.length >= 64) return;
    const oldTrack = tl.tracks.find((x) => x.id === selected.trackId)!;
    const track = { ...oldTrack, id: crypto.randomUUID(), solo: false };
    const copy = { ...asset, id: crypto.randomUUID(), name: asset.name + ' copy' };
    const clip = {
      ...selected,
      id: crypto.randomUUID(),
      assetId: copy.id,
      trackId: track.id,
      start: 0,
      fadeIn: 0,
      fadeOut: 0,
    };
    commit({
      ...tl,
      tracks: [...tl.tracks, track],
      assets: [...tl.assets, copy],
      strips: [...tl.strips, clip],
    });
    s.selectStrip(clip.id);
  }
  function split() {
    if (!selected || locked || selected.repeat !== 1) return;
    const sourceTime = selected.in + (s.time - selected.start) * selected.speed;
    if (sourceTime <= selected.in + 1 / 30 || sourceTime >= selected.out - 1 / 30) return;
    const right = {
      ...selected,
      id: crypto.randomUUID(),
      start: snap(s.time),
      in: sourceTime,
      fadeIn: 0,
    };
    commit({
      ...tl,
      strips: tl.strips.flatMap((x) =>
        x.id === selected.id ? [{ ...x, out: sourceTime, fadeOut: 0 }, right] : [x],
      ),
    });
    s.selectStrip(right.id);
  }
  function pointerDown(e: React.PointerEvent, clip: Strip, mode: Drag['mode']) {
    if (tl.tracks.find((t) => t.id === clip.trackId)?.locked) return;
    e.stopPropagation();
    s.selectStrip(clip.id);
    s.set({ playing: false });
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      id: clip.id,
      origin: e.clientX,
      original: clip,
      next: clip,
      mode,
      width: e.currentTarget.closest('.nla-lane')!.getBoundingClientRect().width,
      scrollStart: scroll.current?.scrollLeft || 0,
      pointerX: e.clientX,
    };
  }
  function moveDrag(clientX: number) {
    const d = drag.current;
    if (!d) return;
    d.pointerX = clientX;
    const delta = snap(
      ((clientX - d.origin + (scroll.current?.scrollLeft || 0) - d.scrollStart) / d.width) *
        MAX_TIMELINE_SECONDS,
    );
    const a = tl.assets.find((a) => a.id === d.original.assetId)!;
    const clip = { ...d.original };
    if (d.mode === 'move')
      clip.start = Math.max(
        0,
        Math.min(MAX_TIMELINE_SECONDS - stripDuration(clip), snap(clip.start + delta)),
      );
    else if (d.mode === 'in') {
      const shift = Math.max(
        -clip.start,
        (-clip.in * clip.repeat) / clip.speed,
        Math.min(delta, ((clip.out - clip.in - 1 / 30) * clip.repeat) / clip.speed),
      );
      clip.start += shift;
      clip.in += (shift * clip.speed) / clip.repeat;
    } else {
      clip.out = Math.max(
        clip.in + 1 / 30,
        Math.min(
          a.duration,
          clip.in + ((MAX_TIMELINE_SECONDS - clip.start) * clip.speed) / clip.repeat,
          clip.out + (delta * clip.speed) / clip.repeat,
        ),
      );
    }
    clip.fadeIn = Math.min(clip.fadeIn, stripDuration(clip));
    clip.fadeOut = Math.min(clip.fadeOut, stripDuration(clip));
    d.next = clip;
    setDragView(clip);
  }
  function pointerMove(e: React.PointerEvent) {
    moveDrag(e.clientX);
  }
  function pointerUp(e: React.PointerEvent) {
    if (!drag.current) return;
    const d = drag.current;
    drag.current = null;
    setDragView(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (JSON.stringify(d.original) !== JSON.stringify(d.next)) update(d.id, d.next);
  }
  const percent = (time: number) => (time / MAX_TIMELINE_SECONDS) * 100;
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    action: (n: number) => void,
    step = 1 / 30,
  ) => (
    <label>
      {t(label)}
      <input
        aria-label={t(label)}
        type="number"
        value={Number(value.toFixed(3))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n) && n >= min && n <= max) action(n);
        }}
      />
    </label>
  );
  return (
    <section className="timeline nla" aria-label={t('Animation timeline')}>
      {previewing && (
        <div className="timeline-preview-notice">
          {t('Preview only — send the animation to the timeline to edit it.')}
        </div>
      )}
      <div className="timeline-bar">
        {!collapsed && (
          <div className="timeline-edit-actions">
            <button
              className="timeline-icon"
              aria-label={t('Duplicate')}
              title={t('Duplicate')}
              disabled={!!locked || !selected}
              onClick={duplicate}
            >
              <ContentCopyOutlinedIcon />
            </button>
            <button
              className="timeline-icon"
              aria-label={t('Split')}
              title={t('Split')}
              disabled={
                !!locked ||
                !selected ||
                selected.repeat !== 1 ||
                s.time <= selected.start ||
                s.time >= stripEnd(selected)
              }
              onClick={split}
            >
              <ContentCutIcon />
            </button>
            <button
              className="timeline-icon"
              aria-label={t('Remove clip')}
              title={t('Remove clip')}
              disabled={!selected || !!locked}
              onClick={() =>
                commit({ ...tl, strips: tl.strips.filter((x) => x.id !== selected!.id) })
              }
            >
              <DeleteOutlineIcon />
            </button>
            <button
              className="hands-template-trigger"
              aria-label={t('Add hands')}
              aria-haspopup="menu"
              aria-expanded={!!handsAnchor}
              aria-controls={handsAnchor ? 'hand-template-menu' : undefined}
              disabled={
                !ready ||
                previewing ||
                tl.tracks.length >= 64 ||
                tl.assets.length >= 32 ||
                tl.strips.length >= 64
              }
              onClick={(e) => setHandsAnchor(e.currentTarget)}
            >
              ＋ {t('Hands')} <span aria-hidden="true">▾</span>
            </button>
            <Menu
              id="hand-template-menu"
              anchorEl={handsAnchor}
              open={!!handsAnchor}
              onClose={() => setHandsAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              MenuListProps={{ 'aria-label': t('Hand templates') }}
            >
              {handPoseSchema.options.map((pose) => (
                <MenuItem
                  key={pose}
                  onClick={() => {
                    s.addHandTemplate(pose);
                    setHandsAnchor(null);
                  }}
                >
                  {t(pose[0].toUpperCase() + pose.slice(1))}
                </MenuItem>
              ))}
            </Menu>
          </div>
        )}
        <div className="playback" data-studio-tour="playback">
          <button
            className="timeline-icon"
            aria-label={t('Back to start')}
            title={t('Back to start')}
            onClick={() => s.set({ time: tl.rangeStart, playing: false })}
          >
            <SkipPreviousIcon />
          </button>
          <button
            className="timeline-icon play-button"
            aria-label={t(s.playing ? 'Pause' : 'Play')}
            title={t(s.playing ? 'Pause' : 'Play')}
            disabled={!ready || previewing || !tl.strips.length}
            onClick={() => s.set({ playing: !s.playing })}
          >
            {s.playing ? <PauseIcon /> : <PlayArrowIcon />}
          </button>
          <button
            className="timeline-icon"
            aria-label={t('Go to end')}
            title={t('Go to end')}
            onClick={() => s.set({ time: tl.rangeEnd, playing: false })}
          >
            <SkipNextIcon />
          </button>
          <span className="timecode">
            <span className="current-time">{s.time.toFixed(2)}</span>
            <span> / {p.duration.toFixed(2)} s</span>
          </span>
          <span className="fps">30 FPS</span>
          <button
            className="timeline-icon"
            aria-label={t('Loop playback')}
            title={t('Loop playback')}
            aria-pressed={tl.loopPlayback}
            onClick={() => s.change({ timeline: { ...tl, loopPlayback: !tl.loopPlayback } })}
          >
            <LoopIcon />
          </button>
        </div>
        <div className="timeline-actions">
          {!collapsed && (
            <>
              <button
                className="timeline-icon"
                title={t('Undo')}
                aria-label={t('Undo')}
                disabled={!s.past.length}
                onClick={s.undo}
              >
                <UndoIcon />
              </button>
              <button
                className="timeline-icon"
                title={t('Redo')}
                aria-label={t('Redo')}
                disabled={!s.future.length}
                onClick={s.redo}
              >
                <RedoIcon />
              </button>
              <label className="nla-zoom">
                {t('Zoom')}
                <input
                  aria-label={t('Timeline zoom')}
                  type="range"
                  min={1}
                  max={4}
                  step={0.5}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                />
              </label>
            </>
          )}
          <button
            className="timeline-icon"
            aria-label={t(collapsed ? 'Show timeline' : 'Minimize timeline')}
            title={t(collapsed ? 'Show timeline' : 'Minimize timeline')}
            aria-expanded={!collapsed}
            aria-controls="timeline-layers"
            onClick={onCollapse}
          >
            {collapsed ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div id="timeline-layers" className="nla-scroll" ref={scroll}>
            <div
              className="nla-sheet"
              style={{
                width: `calc(160px + (100% - 160px) * ${(MAX_TIMELINE_SECONDS / Math.max(1, p.duration)) * zoom})`,
              }}
            >
              <div className="nla-row nla-ruler">
                <div className="nla-layer-label">{t('Layers')}</div>
                <div
                  className="nla-lane"
                  onPointerDown={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    s.set({
                      playing: false,
                      time: snap(
                        Math.max(
                          0,
                          Math.min(
                            p.duration,
                            ((e.clientX - r.left) / r.width) * MAX_TIMELINE_SECONDS,
                          ),
                        ),
                      ),
                    });
                  }}
                >
                  {Array.from({ length: 11 }, (_, i) => (
                    <span key={i} style={{ left: `${i * 10}%` }}>
                      {i}s
                    </span>
                  ))}
                  <input
                    className="scrubber"
                    aria-label={t('Animation position')}
                    type="range"
                    min={0}
                    max={MAX_TIMELINE_SECONDS}
                    step={1 / 30}
                    value={s.time}
                    onChange={(e) =>
                      s.set({ time: Math.min(p.duration, Number(e.target.value)), playing: false })
                    }
                  />
                </div>
              </div>
              {[...tl.tracks].reverse().map((track) => (
                <div
                  className={
                    'nla-row layer-' + (track.kind || 'body') + (track.muted ? ' muted' : '')
                  }
                  key={track.id}
                >
                  <div className="nla-layer-label">
                    <small className="layer-kind">
                      {t(track.kind === 'hands' ? 'Hands' : 'Body')}
                    </small>
                    <input
                      aria-label={`${t('Layer name')} ${track.name}`}
                      value={track.name}
                      maxLength={80}
                      disabled={track.locked}
                      onChange={(e) =>
                        commit({
                          ...tl,
                          tracks: tl.tracks.map((x) =>
                            x.id === track.id ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <div className="layer-buttons">
                      {(['muted', 'solo', 'locked'] as const).map((key, i) => (
                        <button
                          key={key}
                          title={t(['Mute layer', 'Solo layer', 'Lock layer'][i])}
                          aria-label={`${t(['Mute layer', 'Solo layer', 'Lock layer'][i])} ${track.name}`}
                          aria-pressed={track[key]}
                          onClick={() =>
                            commit({
                              ...tl,
                              tracks: tl.tracks.map((x) =>
                                x.id === track.id ? { ...x, [key]: !x[key] } : x,
                              ),
                            })
                          }
                        >
                          {['M', 'S', '⌑'][i]}
                        </button>
                      ))}
                      <button
                        title={t('Move layer up')}
                        disabled={track.locked || tl.tracks.at(-1)?.id === track.id}
                        onClick={() => {
                          const tracks = [...tl.tracks],
                            i = tracks.findIndex((x) => x.id === track.id);
                          [tracks[i], tracks[i + 1]] = [tracks[i + 1], tracks[i]];
                          commit({ ...tl, tracks });
                        }}
                      >
                        ↑
                      </button>
                      <button
                        title={t('Move layer down')}
                        disabled={track.locked || tl.tracks[0]?.id === track.id}
                        onClick={() => {
                          const tracks = [...tl.tracks],
                            i = tracks.findIndex((x) => x.id === track.id);
                          [tracks[i], tracks[i - 1]] = [tracks[i - 1], tracks[i]];
                          commit({ ...tl, tracks });
                        }}
                      >
                        ↓
                      </button>
                      <button
                        title={t('Remove layer')}
                        aria-label={`${t('Remove layer')} ${track.name}`}
                        disabled={track.locked}
                        onClick={() =>
                          commit({
                            ...tl,
                            tracks: tl.tracks.filter((x) => x.id !== track.id),
                            strips: tl.strips.filter((x) => x.trackId !== track.id),
                          })
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="nla-lane">
                    <div
                      className="nla-range"
                      style={{
                        left: `${percent(tl.rangeStart)}%`,
                        width: `${percent(tl.rangeEnd - tl.rangeStart)}%`,
                      }}
                    />
                    {tl.strips
                      .filter((x) => x.trackId === track.id)
                      .map((original) => {
                        const clip = dragView?.id === original.id ? dragView : original,
                          a = tl.assets.find((a) => a.id === clip.assetId)!;
                        return (
                          <div
                            key={clip.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`${t('Clip')}: ${a.name}`}
                            aria-pressed={selected?.id === clip.id}
                            className={
                              'nla-clip ' +
                              (selected?.id === clip.id ? 'selected ' : '') +
                              (clip.muted ? 'muted' : '')
                            }
                            style={{
                              left: `${percent(clip.start)}%`,
                              width: `${percent(stripDuration(clip))}%`,
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                s.selectStrip(clip.id);
                              }
                            }}
                            onClick={() => s.selectStrip(clip.id)}
                            onPointerDown={(e) => pointerDown(e, clip, 'move')}
                            onPointerMove={pointerMove}
                            onPointerUp={pointerUp}
                            onPointerCancel={() => {
                              drag.current = null;
                              setDragView(null);
                            }}
                          >
                            <div
                              className="nla-fade in"
                              style={{
                                width: `${Math.min(100, (clip.fadeIn / stripDuration(clip)) * 100)}%`,
                              }}
                            />
                            <div
                              className="nla-fade out"
                              style={{
                                width: `${Math.min(100, (clip.fadeOut / stripDuration(clip)) * 100)}%`,
                              }}
                            />
                            <strong>{a.name}</strong>
                            <span
                              className="nla-trim left"
                              title={t('Trim start')}
                              onPointerDown={(e) => pointerDown(e, clip, 'in')}
                            />
                            <span
                              className="nla-trim right"
                              title={t('Trim end')}
                              onPointerDown={(e) => pointerDown(e, clip, 'out')}
                            />
                            {Array.from({ length: clip.repeat - 1 }, (_, i) => (
                              <span
                                className="nla-repeat-marker"
                                key={i}
                                style={{ left: `${((i + 1) / clip.repeat) * 100}%` }}
                              />
                            ))}
                          </div>
                        );
                      })}
                    <div className="playhead" style={{ left: `${percent(s.time)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="timeline-bottom-bar" aria-label={t('Animation settings')}>
            <fieldset className="nla-inspector" disabled={!selected || !!locked}>
              <legend className="sr-only">{t('Selected clip')}</legend>
              {number(
                'Speed',
                selected?.speed ?? 1,
                selected
                  ? Math.max(
                      0.1,
                      ((selected.out - selected.in) * selected.repeat) /
                        (MAX_TIMELINE_SECONDS - selected.start),
                    )
                  : 0.1,
                4,
                (n) => selected && update(selected.id, { speed: n }),
                0.1,
              )}
              {number(
                'Repeat clip',
                selected?.repeat ?? 1,
                1,
                selected
                  ? Math.min(
                      32,
                      Math.floor(
                        ((MAX_TIMELINE_SECONDS - selected.start) * selected.speed) /
                          (selected.out - selected.in) +
                          1e-6,
                      ),
                    )
                  : 32,
                (n) => selected && update(selected.id, { repeat: Math.round(n) }),
                1,
              )}
              <label>
                {t('Blend mode')}
                <select
                  aria-label={t('Blend mode')}
                  disabled={handsLayer}
                  value={handsLayer ? 'replace' : (selected?.blend ?? 'replace')}
                  onChange={(e) =>
                    selected && update(selected.id, { blend: e.target.value as Strip['blend'] })
                  }
                >
                  <option value="replace">{t('Replace')}</option>
                  <option value="additive">{t('Combine')}</option>
                </select>
              </label>
              <label>
                {t('Influence')} · {Math.round((selected?.influence ?? 1) * 100)}%
                <input
                  aria-label={t('Clip influence')}
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selected?.influence ?? 1}
                  onChange={(e) =>
                    selected && update(selected.id, { influence: Number(e.target.value) })
                  }
                />
              </label>
              {number(
                'Blend in',
                selected?.fadeIn ?? 0,
                0,
                selected ? stripDuration(selected) : 0,
                (n) => selected && update(selected.id, { fadeIn: n }),
                0.1,
              )}
              {number(
                'Blend out',
                selected?.fadeOut ?? 0,
                0,
                selected ? stripDuration(selected) : 0,
                (n) => selected && update(selected.id, { fadeOut: n }),
                0.1,
              )}
              <label>
                {t('Style')}
                <select
                  aria-label={t('Style')}
                  value={selected?.curve ?? 'smooth'}
                  onChange={(e) =>
                    selected && update(selected.id, { curve: e.target.value as Strip['curve'] })
                  }
                >
                  <option value="smooth">{t('Smooth')}</option>
                  <option value="linear">{t('Linear')}</option>
                </select>
              </label>
            </fieldset>
            <div className="timeline-loop-setting">
              {number(
                'Timeline loop',
                tl.seamless ? tl.seamDuration : 0,
                0,
                Math.min(2, p.duration / 2),
                (n) =>
                  s.change({
                    timeline: { ...tl, seamless: n > 0, seamDuration: Math.max(0.1, n) },
                  }),
                0.1,
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
