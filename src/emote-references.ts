import catalog from './assets/emote-reference-profiles.json' with { type: 'json' };

export const emoteReferences = catalog.references;
export type ReferenceId =
  | 'chic'
  | 'spotlight'
  | 'pose_spin'
  | 'pose_jump'
  | 'run'
  | 'walk'
  | 'jump'
  | 'idle'
  | 'fashionista';
export function referenceProfile(id: ReferenceId) {
  const profile = emoteReferences.find((reference) => reference.id === id);
  if (!profile) throw Error(`Missing emote reference: ${id}`);
  return profile;
}

// Authored motion is evidence for useful rig ranges, not a universal anatomical
// maximum. Add a small margin and retain conservative safety ceilings.
const degrees = (value: number) => (value * Math.PI) / 180;
export const referenceCalibration = {
  version: 'dcl-reference-glbs-v1',
  wristSwing: degrees(
    Math.min(
      85,
      Math.max(60, Math.ceil(Math.max(...emoteReferences.map((r) => r.wristSwingP99Degrees)) + 5)),
    ),
  ),
  wristTwist: degrees(
    Math.min(
      105,
      Math.max(80, Math.ceil(Math.max(...emoteReferences.map((r) => r.wristTwistP99Degrees)) + 5)),
    ),
  ),
};

/** Soft generation references; explicit prompts and pose constraints take priority. */
export const styleReferences = {
  dance: {
    sources: ['walk', 'pose_spin', 'fashionista'] as ReferenceId[],
    guidance:
      'Use alternating weight transfers, coordinated torso and arms, readable turns when requested, and clearly shaped poses. Preserve a lifted foot during a step or turn.',
  },
  celebration: {
    sources: ['spotlight', 'pose_jump', 'jump'] as ReferenceId[],
    guidance:
      'Use a readable preparation, an expressive peak and a controlled recovery. If the action includes a jump, include take-off, free flight and a bent-knee landing.',
  },
  meme: {
    sources: ['chic', 'fashionista', 'pose_jump'] as ReferenceId[],
    guidance:
      'Separate anticipation, the main gesture and a brief readable pose. Use expressive silhouettes and deliberate timing appropriate to the requested joke.',
  },
  emotion: {
    sources: ['chic', 'fashionista', 'idle'] as ReferenceId[],
    guidance:
      'Coordinate head, torso and arm gestures with the requested emotion, with readable poses and natural weight shifts.',
  },
  rest: {
    sources: ['idle'] as ReferenceId[],
    guidance:
      'Prefer quiet breathing, small pelvis changes and relaxed wrists for a resting action. Keep support stable while allowing the movement explicitly requested.',
  },
};
