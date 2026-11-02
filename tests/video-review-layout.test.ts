import { describe, expect, it } from 'vitest';
import { containedVideo } from '../src/video-review-layout';

describe('video review coordinate fit', () => {
  it('keeps portrait landmarks inside the visible video rather than the side margins', () => {
    const fit = containedVideo(1080, 1920, 600, 480);
    expect(fit).toEqual({ left: 165, top: 0, width: 270, height: 480 });
    const pixel = { x: fit.left + 0.25 * fit.width, y: fit.top + 0.75 * fit.height };
    expect((pixel.x - fit.left) / fit.width).toBe(0.25);
    expect((pixel.y - fit.top) / fit.height).toBe(0.75);
    expect(fit.left + fit.width).toBeLessThan(600);
  });
  it('keeps landscape landmarks out of the upper and lower margins', () => {
    const fit = containedVideo(1920, 1080, 480, 480);
    expect(fit).toEqual({ left: 0, top: 105, width: 480, height: 270 });
  });
});
