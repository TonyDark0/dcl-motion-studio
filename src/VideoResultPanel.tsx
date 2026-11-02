import { useStudio } from './store';
import { useT } from './i18n';
import { elapsedLabel } from './video-result';

export function VideoResultPanel() {
  const project = useStudio((s) => s.project),
    selected = useStudio((s) => s.selectedStrip);
  const t = useT(),
    tl = project.timeline;
  const selectedAsset = tl?.assets.find(
    (a) => a.id === tl.strips.find((s) => s.id === selected)?.assetId,
  );
  const result =
    selectedAsset?.videoResult || tl?.assets.filter((a) => a.videoResult).at(-1)?.videoResult;
  if (!tl || !result) return null;
  const targets = tl.assets.filter((a) => a.videoResult?.generationId === result.generationId);
  const byKind = (kind: 'body' | 'hands') =>
    targets.filter((a) =>
      tl.strips.some(
        (s) => s.assetId === a.id && tl.tracks.find((t) => t.id === s.trackId)?.kind === kind,
      ),
    );
  function update(kind: 'body' | 'hands', smoothing: number) {
    const ids = new Set(byKind(kind).map((a) => a.id));
    useStudio.getState().change({
      timeline: {
        ...tl!,
        assets: tl!.assets.map((a) => (ids.has(a.id) ? { ...a, smoothing } : a)),
      },
    });
  }
  return (
    <section className="video-result-panel" aria-label={t('Adjust this emote')}>
      <strong>{t('Adjust this emote')}</strong>
      {(['body', 'hands'] as const).map((kind) => {
        const assets = byKind(kind);
        const label = t(kind === 'body' ? 'Movement smoothness' : 'Hand smoothness');
        const locked = tl.strips.some(
          (s) =>
            assets.some((a) => a.id === s.assetId) &&
            tl.tracks.find((t) => t.id === s.trackId)?.locked,
        );
        return (
          <label className="result-slider" key={kind}>
            <span>
              {label}
              <small>{Math.round((assets[0]?.smoothing || 0) * 100)}%</small>
            </span>
            <input
              type="range"
              aria-label={label}
              min={0}
              max={1}
              step={0.05}
              value={assets[0]?.smoothing || 0}
              disabled={!assets.length || locked}
              onChange={(e) => update(kind, Number(e.target.value))}
            />
          </label>
        );
      })}
      <p className="small subtle">
        {t('Adjust the movement here. Your changes also apply to export.')}
      </p>
      <dl className="video-timings">
        <div>
          <dt>{t('Capture')}</dt>
          <dd>{elapsedLabel(result.processing.captureMs)}</dd>
        </div>
        <div>
          <dt>{t('Generation')}</dt>
          <dd>{elapsedLabel(result.processing.generationMs)}</dd>
        </div>
        <div>
          <dt>{t('Processing time')}</dt>
          <dd>{elapsedLabel(result.processing.totalMs)}</dd>
        </div>
      </dl>
    </section>
  );
}
