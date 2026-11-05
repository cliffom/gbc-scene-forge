/** Exact scoped RGBA colors; membership and counts stay bounded independently of area. */
import type { Color, Rectangle } from './pixel-model.mts';

export const MAX_PALETTE_COLORS = 1024;
export function paletteColors(
  pixels: Uint8ClampedArray,
  options: {
    width?: number;
    view?: Rectangle | null;
    visibleOnly?: boolean;
    order?: 'hue' | 'usage';
  } = {},
) {
  const found = new Map<number, Color>();
  const counts = new Map<number, number>();
  let limited = false;
  const width = options.width ?? pixels.length / 4;
  const view = options.view ?? { x: 0, y: 0, width, height: pixels.length / 4 / width };
  for (let y = view.y; y < view.y + view.height; y++) {
    for (let x = view.x; x < view.x + view.width; x++) {
      const i = (y * width + x) * 4;
      if (options.visibleOnly && pixels[i + 3] === 0) {
        continue;
      }
      const key =
        pixels[i] * 16777216 + pixels[i + 1] * 65536 + pixels[i + 2] * 256 + pixels[i + 3];
      if (!found.has(key)) {
        if (found.size === MAX_PALETTE_COLORS) {
          limited = true;
          continue;
        }
        found.set(key, [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]);
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
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
    if (options.order === 'usage') {
      const key = (c: Color) => c[0] * 16777216 + c[1] * 65536 + c[2] * 256 + c[3];
      const difference = (counts.get(key(b)) ?? 0) - (counts.get(key(a)) ?? 0);
      if (difference) {
        return difference;
      }
    }
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
