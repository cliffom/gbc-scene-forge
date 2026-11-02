import assert from 'node:assert/strict';
import { decodeCandidate } from '../../../frontend/artwork/artwork-contracts.mts';
import { encoded, PixelModel, type Color } from '../../../frontend/artwork/pixel-model.mts';
import { ArtworkSession } from '../../../frontend/artwork/artwork-session.mts';
import { record, array, number } from '../../../frontend/shared/decode.mts';
import type { ProjectApi } from '../../../frontend/project/project-api.mts';
const red: Color = [220, 40, 30, 255],
  hidden: Color = [1, 2, 3, 0];
const candidate = decodeCandidate({
  version: 1,
  document_id: '33333333-3333-4333-8333-333333333333',
  atlas_id: 'grass',
  source: null,
  metadata: {},
  descriptor: {
    version: 1,
    id: '33333333-3333-4333-8333-333333333333',
    pixel_format: 'rgba8',
    provenance: null,
    width: 8,
    height: 8,
    kind: 'tile',
    name: 'Grass',
    origin: [0, 0],
    atlas_id: 'grass',
    region: 'artwork',
  },
  rgba: encoded(new Uint8ClampedArray(256)),
  revision: 'a'.repeat(64),
  project_revision: 'b'.repeat(64),
  project_id: '22222222-2222-4222-8222-222222222222',
  artwork_revision: 'c'.repeat(64),
  operation: 'edit',
});
const m = new PixelModel(candidate);
m.begin();
m.line({ x: 0, y: 0 }, { x: 7, y: 7 }, red);
m.finish();
assert.equal(m.undoStack.length, 1);
assert.deepEqual(m.color({ x: 3, y: 3 }), red);
m.undo();
assert.deepEqual(m.color({ x: 3, y: 3 }), [0, 0, 0, 0]);
m.redo();
assert.deepEqual(m.color({ x: 3, y: 3 }), red);
m.begin();
m.put({ x: 0, y: 1 }, hidden);
m.cancel();
assert.deepEqual(m.color({ x: 0, y: 1 }), [0, 0, 0, 0]);
m.apply(() => m.rectangle({ x: 1, y: 1 }, { x: 5, y: 5 }, hidden));
assert.deepEqual(m.color({ x: 3, y: 1 }), hidden);
m.apply(() => m.fill({ x: 2, y: 3 }, red));
assert.deepEqual(m.color({ x: 2, y: 3 }), red);
assert.deepEqual(m.color({ x: 0, y: 7 }), [0, 0, 0, 0]);
m.select({ x: 1, y: 1 }, { x: 2, y: 2 });
m.copy();
m.apply(() => m.paste({ x: 5, y: 5 }));
assert.deepEqual(m.color({ x: 5, y: 5 }), hidden);
m.apply(() => m.move(1, 0));
assert.deepEqual(m.color({ x: 6, y: 5 }), hidden);
m.undo();
assert.deepEqual(m.selection, { x: 5, y: 5, width: 2, height: 2 });
m.redo();
assert.deepEqual(m.selection, { x: 6, y: 5, width: 2, height: 2 });
const before = encoded(m.pixels);
assert.throws(() => m.apply(() => m.move(5, 0)), /leave/);
assert.equal(encoded(m.pixels), before);
m.selection = null;
m.apply(() => m.transform('horizontal'));
assert.deepEqual(m.color({ x: 1, y: 5 }), hidden);
m.undo();
assert.equal(encoded(m.pixels), before);
m.apply(() => m.transform('vertical'));
m.undo();
m.apply(() => m.transform('rotate'));
m.undo();
assert.equal(encoded(m.pixels), before);
const redoLength = m.redoStack.length;
m.apply(() => {});
assert.equal(m.redoStack.length, redoLength);
assert.throws(() => decodeCandidate({ ...candidate, rgba: 'a' }));
assert.throws(() =>
  decodeCandidate({ ...candidate, descriptor: { ...candidate.descriptor, width: 1000 } }),
);

// A checkpoint captures a stroke's exact pixels even while later strokes arrive.
let release: (() => void) | undefined;
let hold = true;
const written: Record<string, unknown>[] = [];
const api: ProjectApi['json'] = async (route, decode, data) => {
  const request = record(data);
  if (route === 'artwork-edit') {
    if (hold) {
      hold = false;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    const c = decodeCandidate(request.candidate),
      model = new PixelModel(c);
    const writes = array(request.writes, record);
    assert.ok(writes.length <= 8000);
    for (const write of writes) {
      const color = array(write.rgba, number);
      model.put({ x: number(write.x), y: number(write.y) }, [
        color[0],
        color[1],
        color[2],
        color[3],
      ]);
    }
    return decode({ ...c, rgba: encoded(model.pixels), revision: 'd'.repeat(64) });
  }
  if (route === 'artwork-draft-write') {
    written.push(Object.assign({}, request));
    return decode({ revision: String(written.length) });
  }
  return decode({});
};
const session = new ArtworkSession(candidate, api);
session.model.apply(() => session.model.put({ x: 0, y: 0 }, hidden));
const first = session.checkpoint();
await new Promise((resolve) => setImmediate(resolve));
session.model.apply(() => session.model.put({ x: 1, y: 0 }, red));
const second = session.checkpoint();
release?.();
await Promise.all([first, second]);
assert.equal(written.length, 2);
assert.equal(written[0].revision, null);
assert.equal(written[1].revision, '1');
assert.deepEqual(
  new PixelModel(decodeCandidate(written[0].candidate)).color({ x: 1, y: 0 }),
  [0, 0, 0, 0],
);
assert.deepEqual(new PixelModel(decodeCandidate(written[1].candidate)).color({ x: 1, y: 0 }), red);
assert.equal(session.uncheckpointed, false);
assert.deepEqual(session.original, candidate);
console.log('Pixel history, drawing, transforms, bounds, and serialized checkpoint races passed.');

// A lost first checkpoint response is inspected before explicit cleanup, never replayed.
const routes: string[] = [];
const ambiguousApi: ProjectApi['json'] = (route, decode) => {
  routes.push(route);
  if (route === 'artwork-draft-write') {
    return Promise.reject(Error('lost acknowledgment'));
  }
  if (route === 'artwork-draft-list') {
    return Promise.resolve(
      decode({ drafts: [{ id: uncertain.id, owner: uncertain.owner, revision: 'stored' }] }),
    );
  }
  return Promise.resolve(decode({}));
};
const uncertain = new ArtworkSession(candidate, ambiguousApi);
await assert.rejects(uncertain.checkpoint(), /lost acknowledgment/);
await uncertain.removeCheckpoint();
assert.deepEqual(routes, ['artwork-draft-write', 'artwork-draft-list', 'artwork-draft-delete']);

// A maximum-size sprite synchronizes through bounded batches without losing pixels.
const largeCandidate = decodeCandidate({
  ...candidate,
  descriptor: { ...candidate.descriptor, kind: 'sprite', width: 256, height: 256 },
  rgba: encoded(new Uint8ClampedArray(256 * 256 * 4)),
});
const large = new ArtworkSession(largeCandidate, api);
large.model.apply(() => large.model.fill({ x: 0, y: 0 }, red));
await large.checkpoint();
const last = written.at(-1);
assert.ok(last);
const largeSaved = new PixelModel(decodeCandidate(last.candidate));
assert.deepEqual(largeSaved.color({ x: 255, y: 255 }), red);
assert.ok(largeSaved.pixels.every((value, index) => value === red[index % 4]));
assert.throws(() =>
  decodeCandidate({ ...candidate, descriptor: { ...candidate.descriptor, origin: [8, 0] } }),
);
assert.throws(() => decodeCandidate({ ...candidate, operation: 'create' }));
assert.throws(() => decodeCandidate({ ...candidate, unexpected: true }));
