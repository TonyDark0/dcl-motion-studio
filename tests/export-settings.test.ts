import { expect, it } from 'vitest';
import { animationName, validateEmoteBounds } from '../src/export-settings';
import { newProject, projectSchema } from '../src/motion';

it('normalizes the actual animation name using the DCL convention', () => {
  expect(animationName('baile de cumbia')).toBe('Baile_De_Cumbia');
  expect(animationName('acción! rápida 💃')).toBe('Accion_Rapida');
  expect(animationName('Talk_To_Hand')).toBe('Talk_To_Hand');
  expect(animationName('123 dance')).toBe('Animation_123_Dance');
  expect(animationName('💃')).toBe('DCL_Motion');
  expect(animationName('x'.repeat(110))).toHaveLength(100);
});
it('migrates and saves the name independently from the project and clip names', () => {
  const { animationName: _, ...old } = newProject();
  expect(projectSchema.parse(old).animationName).toBe('DCL_Motion');
  expect(projectSchema.parse({ ...old, animationName: 'Cumbia' }).animationName).toBe('Cumbia');
});
it('checks the root cylinder and the full avatar height and lateral area', () => {
  const bounds = { min: { x: -0.4, y: 0, z: -0.3 }, max: { x: 0.4, y: 1.9, z: 0.3 } };
  expect(() => validateEmoteBounds({ x: 1, z: 0 }, bounds, 0)).not.toThrow();
  expect(() => validateEmoteBounds({ x: 0.8, z: 0.8 }, bounds, 2)).toThrow(/1 m/);
  expect(() =>
    validateEmoteBounds({ x: 0, z: 0 }, { ...bounds, max: { ...bounds.max, y: 4.1 } }, 3),
  ).toThrow(/4 m/);
  expect(() =>
    validateEmoteBounds({ x: 0, z: 0 }, { ...bounds, min: { ...bounds.min, x: -2.1 } }, 3),
  ).toThrow(/4 m/);
});
