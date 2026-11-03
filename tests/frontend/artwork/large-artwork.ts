import assert from 'node:assert/strict';
import { decodeCandidate, decodeDescriptor } from '../../../frontend/artwork/artwork-contracts.mts';
import {
  MAX_ARTWORK_AXIS,
  MAX_ARTWORK_PIXELS,
  MAX_HISTORY_BYTES,
} from '../../../frontend/artwork/artwork-limits.mts';
import { paletteColors, MAX_PALETTE_COLORS } from '../../../frontend/artwork/artwork-palette.mts';
import { PixelModel } from '../../../frontend/artwork/pixel-model.mts';
import { ArtworkSession } from '../../../frontend/artwork/artwork-session.mts';
import type { ProjectApi } from '../../../frontend/project/project-api.mts';
import { record } from '../../../frontend/shared/decode.mts';

const descriptor = {
  version: 1,
  id: '33333333-3333-4333-8333-333333333333',
  atlas_id: 'card',
  region: 'artwork',
  name: 'Card',
  kind: 'sprite',
  width: 1500,
  height: 2100,
  origin: [0, 0],
  pixel_format: 'rgba8',
  provenance: null,
};
for (const [width, height] of [
  [1, 1],
  [4096, 1],
  [2048, 2048],
  [375, 525],
  [822, 1122],
]) {
  decodeDescriptor({ ...descriptor, width, height });
}
for (const [width, height] of [
  [0, 1],
  [4097, 1],
  [2048, 2049],
  [4096, 4096],
  [1.5, 1],
]) {
  assert.throws(() => decodeDescriptor({ ...descriptor, width, height }));
}
assert.equal(MAX_ARTWORK_AXIS, 4096);
assert.equal(MAX_ARTWORK_PIXELS, 4_194_304);
assert.throws(() => decodeDescriptor({ ...descriptor, kind: 'tile' }));
const candidate = decodeCandidate({
  version: 1,
  document_id: descriptor.id,
  atlas_id: 'card',
  descriptor,
  project_id: '22222222-2222-4222-8222-222222222222',
  project_revision: 'b'.repeat(64),
  artwork_revision: 'c'.repeat(64),
  revision: 'a'.repeat(64),
  source: null,
  operation: 'edit',
  metadata: {},
  rgba: Buffer.alloc(descriptor.width * descriptor.height * 4).toString('base64'),
});
const model = new PixelModel(candidate);
for (let i = 0; i < 100; i++) {
  model.apply(() => model.put({ x: i, y: 2099 }, [i, 2, 3, 0]));
}
assert.equal(model.undoStack.length, 100);
assert.ok(
  model.undoStack.reduce(
    (sum, item) => sum + item.chunks.reduce((n, c) => n + c.bytes.byteLength, 0),
    0,
  ) < MAX_HISTORY_BYTES,
);
for (let i = 0; i < 100; i++) {
  model.undo();
}
assert.deepEqual(model.color({ x: 99, y: 2099 }), [0, 0, 0, 0]);
for (let i = 0; i < 100; i++) {
  model.redo();
}
assert.deepEqual(model.color({ x: 99, y: 2099 }), [99, 2, 3, 0]);
model.begin();
model.put({ x: 1499, y: 2099 }, [5, 6, 7, 0]);
model.cancel();
assert.deepEqual(model.color({ x: 1499, y: 2099 }), [0, 0, 0, 0]);

const colors = [
  [0, 0, 255, 255],
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [255, 255, 0, 128],
  [3, 3, 3, 0],
  [3, 3, 3, 255],
];
const palette = paletteColors(Uint8ClampedArray.from(colors.flat()));
assert.deepEqual(palette.colors, [
  colors[4],
  colors[5],
  colors[1],
  colors[3],
  colors[2],
  colors[0],
]);
assert.equal(palette.limited, false);
const many = new Uint8ClampedArray((MAX_PALETTE_COLORS + 1) * 4);
for (let i = 0; i <= MAX_PALETTE_COLORS; i++) {
  many.set([i % 256, Math.floor(i / 256), 0, 255], i * 4);
}
assert.equal(paletteColors(many).limited, true);
assert.equal(paletteColors(many).colors.length, MAX_PALETTE_COLORS);

// Chunk synchronization sends full RGBA only at retain/export boundaries.
const routes: string[] = [];
const api: ProjectApi['json'] = (route, decode, data = {}) => {
  routes.push(route);
  if (route === 'artwork-candidate-retain') {
    return Promise.resolve(decode({ handle: 'old' }));
  }
  if (route === 'artwork-edit') {
    assert.equal(record(record(data).candidate).handle, 'old');
    const patch = record(record(data).patch),
      rect = record(patch.rectangle);
    assert.ok(Number(rect.width) * Number(rect.height) <= 65536);
    assert.equal('rgba' in record(record(data).candidate), false);
    return Promise.resolve(decode({ handle: 'new' }));
  }
  if (route === 'artwork-candidate-export') {
    return Promise.resolve(decode(candidate));
  }
  return Promise.resolve(decode({}));
};
const session = new ArtworkSession(candidate, api);
session.model.apply(() => session.model.put({ x: 1499, y: 2099 }, [1, 2, 3, 0]));
await session.synchronizeCurrent();
assert.deepEqual(routes, [
  'artwork-candidate-retain',
  'artwork-edit',
  'artwork-candidate-release',
  'artwork-candidate-export',
  'artwork-candidate-release',
]);
console.log(
  'Large artwork limits, sparse history, exact hue palette and bounded compact synchronization passed.',
);
