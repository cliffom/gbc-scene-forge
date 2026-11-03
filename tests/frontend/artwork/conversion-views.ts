import assert from 'node:assert/strict';
import { conversionViews } from '../../../frontend/artwork/conversion-views.mts';
import { decodeObject } from '../../../frontend/objects/objects.mts';
import type { Atlas } from '../../../frontend/project/project-contracts.mts';

const atlas: Atlas = {
  png: '',
  mappings: {},
  metadata: {},
  animations: [],
  regions: [{ name: 'pose', kind: 'sprite', x: 0, y: 0, width: 16, height: 16, origin: [4, 8] }],
};
const sprite = (id: number, x: number, y: number, origin?: number[]) =>
  decodeObject({ id, asset: 'scenery/pose', x, y, ...(origin ? { origin } : {}) });
const nearby = conversionViews(
  [sprite(1, 324, 328), sprite(2, 412, 400, [12, 0])],
  { scenery: atlas },
  800,
  800,
);
assert.deepEqual(nearby, [{ x: 240, y: 240, width: 256, height: 256 }]);
assert.deepEqual(conversionViews([sprite(1, 4, 8)], { scenery: atlas }, 16, 16), [
  { x: 0, y: 0, width: 16, height: 16 },
]);

// Every pixel of a large imported sprite must appear in some bounded view.
const large = { ...atlas, regions: [{ ...atlas.regions[0], width: 520, height: 504 }] };
const views = conversionViews([sprite(1, 284, 288)], { scenery: large }, 800, 800);
for (let y = 280; y < 784; y++) {
  for (let x = 280; x < 800; x++) {
    assert.ok(views.some((v) => x >= v.x && y >= v.y && x < v.x + v.width && y < v.y + v.height));
  }
}
assert.ok(
  views.every(
    (v) => v.width <= 256 && v.height <= 256 && v.x + v.width <= 800 && v.y + v.height <= 800,
  ),
);
console.log(
  'Conversion views cover clustered and large sprites with origins and scene-edge bounds.',
);
