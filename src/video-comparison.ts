import type { Project } from './motion';
import { activeTracks, stripEnd, stripTime } from './timeline';
export function comparisonAt(project: Project, selected: string | null, time: number) {
  const tl = project.timeline;
  if (!tl) return null;
  const tracks = new Set(activeTracks(tl).map((t) => t.id));
  const candidates = tl.strips.filter(
    (s) => tracks.has(s.trackId) && !s.muted && time >= s.start && time <= stripEnd(s) + 1e-6,
  );
  const valid = candidates.filter(
    (s) => tl.assets.find((a) => a.id === s.assetId)?.videoResult?.referenceAvailable,
  );
  const strip = valid.find((s) => s.id === selected) || valid.at(-1);
  if (!strip) return null;
  const asset = tl.assets.find((a) => a.id === strip.assetId)!;
  return {
    id: asset.videoResult!.generationId,
    name: asset.name,
    time: Math.min(stripTime(strip, time).time, asset.duration - 1 / 30),
    speed: strip.speed,
  };
}
