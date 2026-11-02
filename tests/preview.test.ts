import { beforeEach, expect, it } from 'vitest';
import { newProject } from '../src/motion';
import { newTimeline } from '../src/timeline';
import { useStudio } from '../src/store';
beforeEach(() => {
  const project = newProject();
  project.timeline = { ...newTimeline(project), assets: [], strips: [] };
  useStudio.getState().load(project);
});
it('keeps a candidate out of the editable project until approval', () => {
  const store = useStudio.getState();
  store.stage({ preset: 'wave', duration: 4 }, 'candidate');
  expect(useStudio.getState().project.timeline!.strips).toHaveLength(0);
  expect(useStudio.getState().preview!.timeline!.strips).toHaveLength(1);
  store.acceptPreview();
  expect(useStudio.getState().preview).toBeNull();
  expect(useStudio.getState().project.timeline!.strips).toHaveLength(1);
  store.stage({ preset: 'squat', duration: 4 });
  store.discardPreview();
  expect(useStudio.getState().project.timeline!.strips).toHaveLength(1);
  expect(useStudio.getState().preview).toBeNull();
});
