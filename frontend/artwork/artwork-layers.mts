/** Exact deterministic layer composition shared by model rendering and save boundaries. */
import type { Candidate } from './artwork-contracts.mts';
export function composite(
  descriptor: Candidate['descriptor'],
  rasters: Map<string, Uint8ClampedArray>,
) {
  const result = new Uint8ClampedArray(descriptor.width * descriptor.height * 4);
  for (const layer of descriptor.layers?.items ?? []) {
    if (!layer.visible || !layer.opacity) {
      continue;
    }
    const source = rasters.get(layer.id);
    if (!source) {
      throw Error('Missing layer pixels.');
    }
    for (let i = 0; i < source.length; i += 4) {
      const alpha = Math.floor((source[i + 3] * layer.opacity + 127) / 255);
      if (!alpha) {
        continue;
      }
      if (alpha === 255 || result[i + 3] === 0) {
        result.set(source.subarray(i, i + 3), i);
        result[i + 3] = alpha;
        continue;
      }
      const denominator = alpha * 255 + result[i + 3] * (255 - alpha);
      for (let c = 0; c < 3; c++) {
        result[i + c] = Math.floor(
          (source[i + c] * alpha * 255 +
            result[i + c] * result[i + 3] * (255 - alpha) +
            Math.floor(denominator / 2)) /
            denominator,
        );
      }
      result[i + 3] = Math.floor((denominator + 127) / 255);
    }
  }
  return result;
}
