/** DCL action name, stored inside glTF animations[0].name, independently of the filename. */
export function animationName(input: string): string {
  const words = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let name = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('_');
  if (!name) return 'DCL_Motion';
  if (!/^[A-Z]/.test(name)) name = 'Animation_' + name;
  return name.slice(0, 100).replace(/_+$/, '');
}
export const EMOTE_MAX_BYTES = 1_000_000;

export function validateEmoteBounds(
  root: { x: number; z: number },
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  },
  time: number,
) {
  if (Math.hypot(root.x, root.z) > 1.001)
    throw Error(
      `Emote root exceeds the 1 m movement radius at ${time.toFixed(2)} s. Use In place or adjust the motion.`,
    );
  if (
    bounds.max.y > 4.001 ||
    bounds.min.x < -2.001 ||
    bounds.max.x > 2.001 ||
    bounds.min.z < -2.001 ||
    bounds.max.z > 2.001
  )
    throw Error(
      `Emote exceeds the 4 m animation area at ${time.toFixed(2)} s. Adjust the motion or export GLB.`,
    );
}
