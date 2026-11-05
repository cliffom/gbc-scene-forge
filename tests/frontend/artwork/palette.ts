import assert from 'node:assert/strict';
import { paletteColors, MAX_PALETTE_COLORS } from '../../../frontend/artwork/artwork-palette.mts';
import { composite } from '../../../frontend/artwork/artwork-layers.mts';
import { decodeDescriptor } from '../../../frontend/artwork/artwork-contracts.mts';

const descriptor = decodeDescriptor({
  version: 1,
  id: '33333333-3333-4333-8333-333333333333',
  pixel_format: 'rgba8',
  provenance: null,
  width: 3,
  height: 2,
  kind: 'sprite',
  name: 'Palette',
  origin: [0, 0],
  atlas_id: 'palette',
  region: 'artwork',
  layers: {
    version: 1,
    items: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Base',
        visible: true,
        opacity: 255,
        locked: false,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'Overlay',
        visible: true,
        opacity: 128,
        locked: false,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        name: 'Hidden',
        visible: false,
        opacity: 255,
        locked: false,
      },
    ],
  },
});
const layerItems = descriptor.layers?.items;
assert.ok(layerItems);
const red = [255, 0, 0, 255],
  blue = [0, 0, 255, 255],
  hidden = [99, 88, 77, 0];
const base = Uint8ClampedArray.from([red, red, hidden, blue, blue, blue].flat());
const overlay = Uint8ClampedArray.from(
  [[0, 255, 0, 255], hidden, [9, 20, 30, 128], hidden, hidden, hidden].flat(),
);
const rasters = new Map([
  [layerItems[0].id, base],
  [layerItems[1].id, overlay],
  [layerItems[2].id, new Uint8ClampedArray(base.length).fill(255)],
]);
const visible = () => paletteColors(composite(descriptor, rasters), { visibleOnly: true });
assert.deepEqual(visible().colors, [red, [127, 128, 0, 255], [9, 20, 30, 64], blue]);
// Borrow source bytes without applying the layer opacity or dropping hidden RGB.
assert.ok(paletteColors(overlay).colors.some((c) => c.join() === hidden.join()));
layerItems[1].visible = false;
assert.deepEqual(visible().colors, [red, blue]);
layerItems[1].visible = true;
layerItems[1].opacity = 0;
assert.deepEqual(visible().colors, [red, blue]);

// Scan only the selected rectangle, retaining alpha variants and exact straight RGB.
assert.deepEqual(
  paletteColors(base, { width: 3, view: { x: 1, y: 1, width: 2, height: 1 }, visibleOnly: true })
    .colors,
  [blue],
);
assert.deepEqual(
  paletteColors(base, { width: 3, view: { x: 2, y: 0, width: 1, height: 1 }, visibleOnly: true })
    .colors,
  [],
);
assert.deepEqual(paletteColors(base, { order: 'usage', visibleOnly: true }).colors, [blue, red]);
assert.deepEqual(paletteColors(new Uint8ClampedArray()).colors, []);

// Opaque occlusion removes the covered color; duplicates count once.
layerItems[1].opacity = 255;
overlay.set([1, 2, 3, 255], 4);
assert.ok(!visible().colors.some((c) => c.join() === red.join()));
assert.equal(paletteColors(Uint8ClampedArray.from([...blue, ...blue])).colors.length, 1);

// Bounded membership still counts subsequent occurrences of included colors for usage order.
const many = new Uint8ClampedArray((MAX_PALETTE_COLORS + 3) * 4);
for (let i = 0; i <= MAX_PALETTE_COLORS; i++) {
  many.set([i % 256, Math.floor(i / 256), 1, 255], i * 4);
}
many.set([255, 0, 1, 255, 255, 0, 1, 255], (MAX_PALETTE_COLORS + 1) * 4);
const limited = paletteColors(many, { order: 'usage' });
assert.equal(limited.limited, true);
assert.equal(limited.colors.length, MAX_PALETTE_COLORS);
assert.deepEqual(limited.colors[0], [255, 0, 1, 255]);
assert.equal(paletteColors(many.subarray(0, MAX_PALETTE_COLORS * 4)).limited, false);
console.log(
  'Composition palettes, exact alpha, visibility, rectangles, ordering and limits passed.',
);
