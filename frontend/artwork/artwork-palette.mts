/** Exact source colors, bounded independently of document area and sorted in hue order. */
import type { Color } from './pixel-model.mts';

export const MAX_PALETTE_COLORS = 1024;
export function paletteColors(pixels: Uint8ClampedArray) {
  const found = new Map<number, Color>();
  let limited = false;
  for (let i = 0; i < pixels.length; i += 4) {
    const key = pixels[i] * 16777216 + pixels[i + 1] * 65536 + pixels[i + 2] * 256 + pixels[i + 3];
    if (!found.has(key)) {
      if (found.size === MAX_PALETTE_COLORS) {
        limited = true;
        break;
      }
      found.set(key, [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]);
    }
  }
  function order(c: Color) {
    const [r, g, b] = c;
    const high = Math.max(r, g, b),
      low = Math.min(r, g, b),
      delta = high - low;
    const hue =
      delta === 0
        ? 0
        : high === r
          ? ((g - b) / delta + 6) % 6
          : high === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4;
    return [delta === 0 ? 0 : 1, hue, (high + low) / 2, delta, c[3], r, g, b];
  }
  const colors = [...found.values()].sort((a, b) => {
    const x = order(a),
      y = order(b);
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i]) {
        return x[i] - y[i];
      }
    }
    return 0;
  });
  return { colors, limited };
}
