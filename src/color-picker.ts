type Rgb = [number, number, number];

export function rgbToHsv([r, g, b]: Rgb) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  return { h: hue, s: max ? delta / max : 0, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const chroma = v * s;
  const segment = (((h % 360) + 360) % 360) / 60;
  const second = chroma * (1 - Math.abs(segment % 2 - 1));
  const base: Rgb = segment < 1 ? [chroma, second, 0]
    : segment < 2 ? [second, chroma, 0]
    : segment < 3 ? [0, chroma, second]
    : segment < 4 ? [0, second, chroma]
    : segment < 5 ? [second, 0, chroma]
    : [chroma, 0, second];
  const offset = v - chroma;
  return base.map(channel => channel + offset) as Rgb;
}
