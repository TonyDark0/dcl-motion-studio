import { describe, expect, it } from 'vitest';
import { generationPrompt } from '../src/emote-style';
import { newProject, projectSchema } from '../src/motion';

describe('emote style presets', () => {
  it('ignores archived style presets and preserves the plain prompt', () => {
    const prompt = 'A person waves hello.';
    expect(generationPrompt(prompt)).toBe(prompt);
    expect(generationPrompt(prompt, 'dance')).toBe(prompt);
    expect(generationPrompt(prompt, 'rest')).toBe(prompt);
  });

  it('persists a selected style and accepts older projects without one', () => {
    const project = newProject();
    project.emoteStyle = 'emotion';
    expect(projectSchema.parse(project).emoteStyle).toBe('emotion');
    const old = { ...project } as Partial<typeof project>;
    delete old.emoteStyle;
    expect(projectSchema.parse(old).emoteStyle).toBeNull();
  });
});
