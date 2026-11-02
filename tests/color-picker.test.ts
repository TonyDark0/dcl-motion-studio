import { describe, expect, it } from 'vitest';
import { hsvToRgb, rgbToHsv } from '../src/color-picker';

describe('compact avatar color picker', () => {
  it('keeps an existing skin or hair color when deriving hue and brightness', () => {
    for (const color of [[0.8, 0.61, 0.46], [0.23, 0.13, 0.04], [0.2, 0.2, 0.2]] as [number, number, number][]) {
      const { h, s, v } = rgbToHsv(color);
      const restored = hsvToRgb(h, s, v);
      restored.forEach((channel, index) => expect(channel).toBeCloseTo(color[index], 5));
    }
  });
});
