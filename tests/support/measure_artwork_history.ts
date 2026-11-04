/** Isolated browser-model history observations; excludes DOM, canvas, image caches and SDK. */
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { PixelModel, encoded } from '../../frontend/artwork/pixel-model.mts';
import { decodeCandidate } from '../../frontend/artwork/artwork-contracts.mts';
import { record } from '../../frontend/shared/decode.mts';

if (process.argv.length === 2) {
  const cases = [
    [256, 256],
    [768, 1024],
  ].map(([w, h]) =>
    record(
      JSON.parse(
        execFileSync(process.execPath, [import.meta.filename, String(w), String(h)], {
          encoding: 'utf8',
        }),
      ),
    ),
  );
  console.log(
    JSON.stringify(
      { node: process.version, platform: process.platform, arch: process.arch, cases },
      null,
      2,
    ),
  );
} else {
  const [width, height] = process.argv.slice(2).map(Number);
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (i * 71 + 17) % 256;
  }
  const model = new PixelModel(
    decodeCandidate({
      version: 1,
      project_id: crypto.randomUUID(),
      document_id: '33333333-3333-4333-8333-333333333333',
      atlas_id: 'picture',
      source: null,
      metadata: {},
      descriptor: {
        version: 1,
        id: '33333333-3333-4333-8333-333333333333',
        atlas_id: 'picture',
        region: 'artwork',
        name: 'Measured',
        pixel_format: 'rgba8',
        provenance: null,
        width,
        height,
        kind: 'sprite',
        origin: [0, 0],
      },
      rgba: encoded(pixels),
      revision: 'a'.repeat(64),
      project_revision: 'b'.repeat(64),
      artwork_revision: 'c'.repeat(64),
      operation: 'edit',
    }),
  );
  const layers = ['Base', 'Effect', 'Hidden'].map((name) => ({
    id: crypto.randomUUID(),
    name,
    visible: true,
    opacity: 255,
    locked: false,
  }));
  const start = performance.now();
  model.apply(() => model.setLayers(layers));
  for (let i = 0; i < 12; i++) {
    model.apply(() => model.put({ x: i, y: i }, [71, 72, 73, i]));
  }
  const retainedBytes = model.undoStack.reduce(
    (sum, item) =>
      sum +
      (item.layerState?.flat?.byteLength ?? 0) +
      [...(item.layerState?.rasters.values() ?? [])].reduce((n, p) => n + p.byteLength, 0) +
      item.chunks.reduce((n, c) => n + c.bytes.byteLength + 16, 0) +
      new TextEncoder().encode(JSON.stringify(item.descriptor)).length +
      64,
    0,
  );
  const composite = model.composite();
  model.undo();
  model.redo();
  if (!model.composite().every((v, i) => v === composite[i])) {
    throw Error('History pixel drift');
  }
  console.log(
    JSON.stringify({
      width,
      height,
      layers: 3,
      attempted_operations: 13,
      retained_operations: model.undoStack.length,
      retained_history_bytes: retainedBytes,
      milliseconds: Math.round((performance.now() - start) * 100) / 100,
      process_peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    }),
  );
}
