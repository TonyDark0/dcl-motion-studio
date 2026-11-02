import type { Page } from '@playwright/test';

// Populate deterministic test clips through the project's source API; the UI no
// longer exposes rig-debug presets in the creation workspace.
export async function addProceduralTestClip(page: Page, preset: 'squat' | 'wave') {
  await page.evaluate(async (preset) => {
    const storePath = '/src/store.ts';
    const motionPath = '/src/motion.ts';
    const [{ useStudio }, { defaults }] = await Promise.all([
      import(storePath),
      import(motionPath),
    ]);
    const studio = useStudio.getState();
    studio.change({
      preset,
      motion: null,
      keyframes: [],
      controls: structuredClone(defaults),
      duration: 4,
      handMode: 'none',
      handReference: null,
    });
    studio.set({ time: 0, playing: true });
  }, preset);
}
