import assert from 'node:assert/strict';
import { decodeCandidate, decodeDescriptor } from '../../../frontend/artwork/artwork-contracts.mts';
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
// Cut uses the active frame's absolute bounds and preserves exact hidden RGB in its clipboard.
const cut = new PixelModel(candidate);
cut.pixels.set(hidden, (2 * 8 + 5) * 4);
cut.pixels.set(red, (3 * 8 + 6) * 4);
cut.bounds = { x: 4, y: 2, width: 4, height: 4 };
cut.apply(() => cut.cut());
assert.deepEqual(cut.color({ x: 5, y: 2 }), [0, 0, 0, 0]);
assert.deepEqual(cut.color({ x: 6, y: 3 }), [0, 0, 0, 0]);
cut.apply(() => cut.paste());
assert.deepEqual(cut.color({ x: 5, y: 2 }), hidden);
assert.deepEqual(cut.color({ x: 6, y: 3 }), red);
cut.undo();
assert.deepEqual(cut.color({ x: 6, y: 3 }), [0, 0, 0, 0]);
cut.undo();
assert.deepEqual(cut.color({ x: 5, y: 2 }), hidden);

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
assert.equal(session.uncheckpointed, false);
session.model.apply(() => session.model.put({ x: 0, y: 0 }, hidden));
session.model.undo();
assert.equal(session.uncheckpointed, false);
session.model.redo();
const first = session.checkpoint();
session.model.undo();
assert.equal(session.changed, false);
assert.equal(session.uncheckpointed, true);
session.model.redo();
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
// Undo to the saved base still diverges from an older durable checkpoint.
session.model.undo();
session.model.undo();
assert.equal(session.changed, false);
assert.equal(session.uncheckpointed, true);
await session.checkpoint();
assert.equal(session.uncheckpointed, false);
assert.equal(decodeCandidate(written.at(-1)?.candidate).rgba, candidate.rgba);
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
  if (route === 'artwork-draft-download') {
    return Promise.resolve(decode({ candidate }));
  }
  return Promise.resolve(decode({}));
};
const uncertain = new ArtworkSession(candidate, ambiguousApi);
await assert.rejects(uncertain.checkpoint(), /lost acknowledgment/);
assert.equal(uncertain.uncheckpointed, true);
await uncertain.removeCheckpoint();
assert.deepEqual(routes, [
  'artwork-draft-write',
  'artwork-draft-list',
  'artwork-draft-download',
  'artwork-draft-delete',
]);
assert.equal(uncertain.uncheckpointed, false);

// Losing an update response must not make Undo to acknowledged pixels look durable.
let storedCandidate = candidate;
let storedRevision = 0;
let loseResponse = false;
let failInspection = false;
const updateRoutes: string[] = [];
const updateApi: ProjectApi['json'] = async (route, decode, data) => {
  if (route === 'artwork-edit') {
    return api(route, decode, data);
  }
  updateRoutes.push(route);
  const request = record(data);
  if (route === 'artwork-draft-write') {
    assert.equal(request.revision, storedRevision ? String(storedRevision) : null);
    storedCandidate = decodeCandidate(request.candidate);
    storedRevision++;
    if (loseResponse) {
      loseResponse = false;
      throw Error('lost update acknowledgment');
    }
    return decode({ revision: String(storedRevision) });
  }
  if (route === 'artwork-draft-list') {
    return decode({
      drafts: [{ id: updated.id, owner: updated.owner, revision: String(storedRevision) }],
    });
  }
  assert.equal(request.revision, String(storedRevision));
  if (route === 'artwork-draft-download') {
    if (failInspection) {
      throw Error('inspection unavailable');
    }
    return decode({ candidate: storedCandidate });
  }
  assert.equal(route, 'artwork-draft-delete');
  return decode({});
};
const updated = new ArtworkSession(candidate, updateApi);
updated.model.apply(() => updated.model.put({ x: 0, y: 0 }, hidden));
await updated.checkpoint();
updated.model.apply(() => updated.model.put({ x: 1, y: 0 }, red));
loseResponse = true;
await assert.rejects(updated.checkpoint(), /lost update acknowledgment/);
updated.model.undo();
assert.equal(encoded(updated.model.pixels), updated.checkpointPixels);
assert.equal(updated.uncheckpointed, true);
failInspection = true;
await assert.rejects(updated.checkpoint(), /inspection unavailable/);
assert.equal(updated.uncheckpointed, true);
failInspection = false;
await updated.checkpoint();
assert.equal(storedRevision, 3);
assert.equal(storedCandidate.rgba, encoded(updated.model.pixels));
assert.equal(updated.uncheckpointed, false);
assert.deepEqual(updateRoutes.slice(-3), [
  'artwork-draft-list',
  'artwork-draft-download',
  'artwork-draft-write',
]);
updated.model.redo();
loseResponse = true;
await assert.rejects(updated.checkpoint(), /lost update acknowledgment/);
await updated.checkpoint();
assert.equal(storedRevision, 4);
assert.equal(updated.uncheckpointed, false);
assert.deepEqual(updateRoutes.slice(-2), ['artwork-draft-list', 'artwork-draft-download']);
updated.model.apply(() => updated.model.put({ x: 2, y: 0 }, red));
loseResponse = true;
await assert.rejects(updated.checkpoint(), /lost update acknowledgment/);
await updated.removeCheckpoint();
assert.deepEqual(updateRoutes.slice(-3), [
  'artwork-draft-list',
  'artwork-draft-download',
  'artwork-draft-delete',
]);

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

// A successful guarded save advances only this document's base and keeps undo usable.
const continued = new ArtworkSession(candidate, api);
continued.model.apply(() => continued.model.put({ x: 2, y: 1 }, hidden));
assert.equal(continued.changed, true);
const savedBase = {
  ...candidate,
  rgba: encoded(continued.model.pixels),
  project_revision: 'd'.repeat(64),
  artwork_revision: 'e'.repeat(64),
};
continued.adoptSaved(savedBase);
assert.equal(continued.changed, false);
assert.equal(continued.original.artwork_revision, 'e'.repeat(64));
continued.model.undo();
assert.equal(continued.changed, true);
assert.deepEqual(continued.model.color({ x: 2, y: 1 }), [0, 0, 0, 0]);
continued.model.redo();
assert.equal(continued.changed, false);
assert.deepEqual(continued.model.color({ x: 2, y: 1 }), hidden);

const sheet = decodeCandidate({
  ...candidate,
  descriptor: {
    ...candidate.descriptor,
    version: 2,
    kind: 'sprite',
    frames: [
      {
        id: 'artwork',
        name: 'Pose',
        kind: 'sprite',
        x: 0,
        y: 0,
        width: 8,
        height: 8,
        origin: [0, 0],
      },
    ],
    sequences: [
      { id: 'walk', name: 'Walk', loop: true, frames: [{ frame_id: 'artwork', duration_ms: 120 }] },
    ],
  },
});
const layoutSession = new ArtworkSession(sheet, () => Promise.reject(Error('Offline layout')));
layoutSession.model.apply(() => layoutSession.model.put({ x: 1, y: 1 }, hidden));
layoutSession.model.apply(() => {
  const d = layoutSession.model.descriptor;
  if (d.version === 2) {
    d.frames[0].name = 'Idle';
    d.sequences[0].frames[0].duration_ms = 277;
    d.frames.push({ ...d.frames[0], id: 'pose_tiles', kind: 'tile', name: 'Tiles' });
  }
});
const offline = layoutSession.downloadWork();
await assert.rejects(layoutSession.synchronizeCurrent(), /Offline layout/);
assert.deepEqual(layoutSession.downloadWork(), offline);
assert.equal(offline.current_descriptor.version, 2);
if (offline.current_descriptor.version !== 2) {
  throw Error('Expected sheet');
}
assert.equal(offline.current_descriptor.sequences[0].frames[0].duration_ms, 277);
assert.equal(offline.current_descriptor.frames[0].name, 'Idle');
assert.equal(offline.current_descriptor.frames.length, 2);
assert.equal(offline.candidate.descriptor.version, 2);
assert.notDeepEqual(offline.current_descriptor, offline.candidate.descriptor);
assert.deepEqual(
  new PixelModel({ ...sheet, rgba: offline.current_rgba }).color({ x: 1, y: 1 }),
  hidden,
);
layoutSession.model.undo();
assert.equal(offline.current_descriptor.frames.length, 2); // Download owns its snapshot.
layoutSession.model.redo();

// Saving makes frame geometry durable, while earlier pixels, names and timing remain undoable.
const savedSheet = decodeCandidate({
  ...sheet,
  descriptor: structuredClone(layoutSession.model.descriptor),
  rgba: encoded(layoutSession.model.pixels),
});
layoutSession.adoptSaved(savedSheet);
layoutSession.model.undo();
const undoLayout = layoutSession.model.descriptor;
assert.equal(undoLayout.version, 2);
if (undoLayout.version !== 2) {
  throw Error('Expected sheet');
}
assert.equal(undoLayout.frames.length, 2);
assert.equal(undoLayout.frames[0].name, 'Pose');
assert.equal(undoLayout.sequences[0].frames[0].duration_ms, 120);
layoutSession.model.undo();
assert.deepEqual(layoutSession.model.color({ x: 1, y: 1 }), [0, 0, 0, 0]);
layoutSession.model.redo();
layoutSession.model.redo();
assert.equal(layoutSession.changed, false);

// Representation-only history becomes a no-op; Undo reaches the earlier pixel edit directly.
const representationSession = new ArtworkSession(sheet, api);
representationSession.model.apply(() => representationSession.model.put({ x: 1, y: 1 }, hidden));
representationSession.model.apply(() => {
  const d = representationSession.model.descriptor;
  if (d.version === 2) {
    d.frames.push({ ...d.frames[0], id: 'pose_tiles', kind: 'tile' });
  }
});
representationSession.adoptSaved({
  ...sheet,
  descriptor: structuredClone(representationSession.model.descriptor),
  rgba: encoded(representationSession.model.pixels),
});
assert.equal(representationSession.model.undoStack.length, 1);
representationSession.model.undo();
assert.deepEqual(representationSession.model.color({ x: 1, y: 1 }), [0, 0, 0, 0]);
assert.deepEqual(representationSession.model.descriptor, representationSession.original.descriptor);
await representationSession.checkpoint();
assert.equal(representationSession.uncheckpointed, false);

// Rebasing saved frames can invalidate some history without invalidating all of it.
const bounded = structuredClone(sheet.descriptor);
if (bounded.version !== 2) {
  throw Error('Expected sheet');
}
for (let total = 1; total <= 1024; total++) {
  const sequences = Array.from({ length: Math.ceil(total / 256) }, (_, index) => ({
    id: `seq_${index}`,
    name: `Sequence ${index}`,
    loop: true,
    frames: Array.from({ length: Math.min(256, total - index * 256) }, () => ({
      frame_id: 'artwork',
      duration_ms: 120,
    })),
  }));
  if (
    new TextEncoder().encode(JSON.stringify({ ...bounded, sequences }, null, 2) + '\n').length >
    65536
  ) {
    break;
  }
  bounded.sequences = sequences;
}
decodeDescriptor(bounded);
const boundedSession = new ArtworkSession(sheet, api);
const boundedModel = boundedSession.model;
boundedModel.apply(() => boundedModel.put({ x: 1, y: 1 }, red));
boundedModel.apply(() => {
  boundedModel.descriptor = structuredClone(bounded);
});
boundedModel.apply(() => boundedModel.put({ x: 1, y: 1 }, hidden));
boundedModel.apply(() => {
  const d = boundedModel.descriptor;
  if (d.version === 2) {
    d.sequences.at(-1)?.frames.splice(-5);
  }
});
boundedModel.apply(() => boundedModel.put({ x: 1, y: 1 }, red));
boundedModel.apply(() => {
  const d = boundedModel.descriptor;
  if (d.version === 2) {
    d.frames.push({ ...d.frames[0], id: 'pose_tiles', kind: 'tile', name: 'Tiles' });
  }
});
boundedSession.adoptSaved(
  decodeCandidate({
    ...sheet,
    descriptor: structuredClone(boundedModel.descriptor),
    rgba: encoded(boundedModel.pixels),
  }),
);
// Valid older snapshots survive even on the far side of the oversized states.
assert.equal(boundedModel.undoStack.length, 3);
while (boundedModel.undoStack.length) {
  boundedModel.undo();
  decodeDescriptor(boundedModel.descriptor);
  assert.equal(boundedModel.descriptor.version === 2 && boundedModel.descriptor.frames.length, 2);
}
assert.deepEqual(boundedModel.color({ x: 1, y: 1 }), [0, 0, 0, 0]);
while (boundedModel.redoStack.length) {
  boundedModel.redo();
  decodeDescriptor(boundedModel.descriptor);
}
assert.equal(boundedSession.changed, false);

// Dirty reads do not serialize RGBA, including hidden RGB and direct byte edits.
const exact = new ArtworkSession(candidate, api);
const encodeBefore = globalThis.btoa;
let dirtyEncodes = 0;
globalThis.btoa = (value) => {
  dirtyEncodes++;
  return encodeBefore(value);
};
try {
  assert.equal(exact.changed, false);
  exact.model.begin();
  exact.model.put({ x: 0, y: 0 }, hidden);
  assert.equal(exact.changed, true);
  assert.equal(exact.uncheckpointed, true);
  exact.model.cancel();
  assert.equal(exact.changed, false);
  exact.model.apply(() => exact.model.put({ x: 1, y: 1 }, hidden));
  exact.model.undo();
  assert.equal(exact.changed, false);
  exact.model.redo();
  assert.equal(exact.changed, true);
  exact.model.undo();
  // Public base replacement and buffer mutation must invalidate comparisons.
  exact.original = { ...candidate, rgba: candidate.rgba };
  exact.model.pixels[3] = 1;
  assert.equal(exact.changed, true);
  exact.model.pixels[3] = 0;
  assert.equal(exact.changed, false);
  assert.equal(dirtyEncodes, 0);
} finally {
  globalThis.btoa = encodeBefore;
}

// Layer migration, hidden source bytes, locks and history are independent of the composite.
const baseLayer = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Base',
  visible: true,
  opacity: 255,
  locked: false,
};
const effectLayer = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'Effect',
  visible: true,
  opacity: 128,
  locked: false,
};
const layered = new PixelModel(candidate);
layered.apply(() => layered.put({ x: 0, y: 0 }, red));
layered.apply(() => layered.setLayers([baseLayer, effectLayer]));
assert.equal(layered.activeLayer, effectLayer.id);
layered.apply(() => layered.put({ x: 0, y: 0 }, [0, 0, 255, 255]));
assert.deepEqual([...layered.composite().slice(0, 4)], [110, 20, 143, 255]);
layered.undo();
assert.deepEqual([...layered.composite().slice(0, 4)], red);
layered.undo();
assert.equal(layered.activeLayer, null);
assert.equal(layered.descriptor.layers, undefined);
assert.deepEqual(layered.color({ x: 0, y: 0 }), red);
layered.undo();
assert.deepEqual(layered.color({ x: 0, y: 0 }), [0, 0, 0, 0]);
layered.redo();
layered.redo();
layered.redo();
assert.deepEqual([...layered.composite().slice(0, 4)], [110, 20, 143, 255]);
layered.apply(() => layered.setLayers([baseLayer, { ...effectLayer, visible: false }]));
const hiddenLayerCandidate = decodeCandidate({
  ...candidate,
  descriptor: layered.descriptor,
  rgba: encoded(layered.composite()),
  layer_rgba: layered.layerEncoding(),
});
const hiddenSession = new ArtworkSession(hiddenLayerCandidate, api);
hiddenSession.model.selectLayer(effectLayer.id);
hiddenSession.model.apply(() => hiddenSession.model.put({ x: 1, y: 0 }, hidden));
assert.equal(hiddenSession.changed, true);
assert.equal(encoded(hiddenSession.model.composite()), hiddenLayerCandidate.rgba);
hiddenSession.model.undo();
assert.equal(hiddenSession.changed, false);
layered.apply(() => layered.setLayers([baseLayer, { ...effectLayer, locked: true }]));
assert.throws(() => layered.apply(() => layered.put({ x: 0, y: 0 }, red)), /locked/);
assert.throws(
  () => layered.apply(() => layered.setLayers([{ ...effectLayer, locked: true }, baseLayer])),
  /Unlock/,
);
assert.throws(() =>
  decodeDescriptor({
    ...candidate.descriptor,
    layers: { version: 1, items: [baseLayer, baseLayer] },
  }),
);
assert.throws(() => decodeCandidate({ ...hiddenLayerCandidate, layer_rgba: {} }));
console.log('Layer migration, exact composite, hidden RGB, locks and Undo/Redo passed.');

// Sheet geometry adoption must retain layer raster history even with no flat XOR chunks.
const sheetLayers = new PixelModel(sheet);
sheetLayers.apply(() => sheetLayers.setLayers([baseLayer, effectLayer]));
const savedLayeredSheet = decodeCandidate({
  ...sheet,
  descriptor: sheetLayers.descriptor,
  rgba: encoded(sheetLayers.composite()),
  layer_rgba: sheetLayers.layerEncoding(),
});
const layerSheetSession = new ArtworkSession(savedLayeredSheet, api);
layerSheetSession.model.selectLayer(effectLayer.id);
layerSheetSession.model.apply(() => layerSheetSession.model.put({ x: 1, y: 1 }, hidden));
layerSheetSession.adoptSaved(
  decodeCandidate({
    ...savedLayeredSheet,
    rgba: encoded(layerSheetSession.model.composite()),
    layer_rgba: layerSheetSession.model.layerEncoding(),
  }),
);
assert.equal(layerSheetSession.changed, false);
assert.equal(layerSheetSession.model.undoStack.length, 1);
layerSheetSession.model.undo();
assert.deepEqual(layerSheetSession.model.color({ x: 1, y: 1 }), [0, 0, 0, 0]);
assert.equal(layerSheetSession.changed, true);
layerSheetSession.model.redo();
assert.equal(layerSheetSession.changed, false);

// Layer metadata rejection short-circuits raster work; clean reads retain every
// distinct source baseline and still observe direct hidden-RGB byte mutations.
const threeLayers = new PixelModel(hiddenLayerCandidate);
const thirdLayer = { ...effectLayer, id: '66666666-6666-4666-8666-666666666666', name: 'Third' };
threeLayers.apply(() => threeLayers.setLayers([baseLayer, effectLayer, thirdLayer]));
threeLayers.apply(() => threeLayers.put({ x: 2, y: 0 }, [8, 9, 10, 0]));
const threeCandidate = decodeCandidate({
  ...candidate,
  descriptor: threeLayers.descriptor,
  rgba: encoded(threeLayers.composite()),
  layer_rgba: threeLayers.layerEncoding(),
});
const three = new ArtworkSession(threeCandidate, api);
const decodeBefore = globalThis.atob;
let sourceDecodes = 0;
globalThis.atob = (raw) => {
  sourceDecodes++;
  return decodeBefore(raw);
};
const compareComposite = three.model.composite.bind(three.model);
three.model.composite = () => {
  throw Error('Dirty checks must not composite layer sources');
};
try {
  three.model.apply(() =>
    three.model.setLayers([{ ...baseLayer, visible: false }, effectLayer, thirdLayer]),
  );
  assert.equal(three.changed, true);
  assert.equal(three.uncheckpointed, true);
  assert.equal(sourceDecodes, 0, 'Metadata changes never decode a pixel baseline');
  three.model.undo();
  assert.equal(three.changed, false);
  const warmed = sourceDecodes;
  assert.ok(warmed >= 2);
  for (let read = 0; read < 10; read++) {
    assert.equal(three.changed, false);
  }
  assert.equal(
    sourceDecodes,
    warmed,
    'All source baselines fit; repeated reads never decode them again',
  );
  for (const layer of [baseLayer, effectLayer, thirdLayer]) {
    three.model.selectLayer(layer.id);
    const previous = three.model.pixels[0];
    three.model.pixels[0] ^= 1;
    assert.equal(three.changed, true, 'Direct hidden/visible source edits are observed');
    three.model.pixels[0] = previous;
    assert.equal(three.changed, false);
  }
} finally {
  globalThis.atob = decodeBefore;
  three.model.composite = compareComposite;
}

// A full small-document synchronization crosses the individual-write chunk boundary.
// Acknowledgements advance each next request's candidate without dropping the final remainder.
{
  const width = 256,
    height = 64;
  const base = decodeCandidate({
    ...candidate,
    descriptor: { ...candidate.descriptor, kind: 'sprite', width, height },
    rgba: encoded(new Uint8ClampedArray(width * height * 4)),
  });
  let remote = base;
  const sizes: number[] = [];
  const synchronize: ProjectApi['json'] = (route, decode, data) => {
    assert.equal(route, 'artwork-edit');
    const request = record(data);
    assert.deepEqual(request.candidate, remote);
    const writes = array(request.writes, record);
    sizes.push(writes.length);
    assert.ok(Buffer.byteLength(JSON.stringify(writes)) <= 1024 * 1024);
    const changed = new PixelModel(remote);
    for (const write of writes) {
      const color = array(write.rgba, number);
      changed.put({ x: number(write.x), y: number(write.y) }, [
        color[0],
        color[1],
        color[2],
        color[3],
      ]);
    }
    remote = decodeCandidate({ ...remote, rgba: encoded(changed.pixels) });
    return Promise.resolve(decode(remote));
  };
  const batched = new ArtworkSession(base, synchronize);
  batched.model.pixels.fill(255);
  await batched.synchronizeCurrent();
  assert.deepEqual(sizes, [8000, 8000, width * height - 16000]);
  assert.equal(remote.rgba, encoded(batched.model.pixels));
  await batched.synchronizeCurrent();
  assert.equal(sizes.length, 3, 'Unchanged pixels send no new batch');
}

// Count eviction preserves the newest operations, no-ops and the earliest retained baseline.
{
  const bounded = new PixelModel(candidate);
  for (let i = 1; i <= 101; i++) {
    bounded.apply(() => bounded.put({ x: 0, y: 0 }, [i, 0, 0, 0]));
  }
  assert.equal(bounded.undoStack.length, 100);
  for (let i = 0; i < 100; i++) {
    bounded.undo();
  }
  assert.deepEqual(bounded.color({ x: 0, y: 0 }), [1, 0, 0, 0]);
  bounded.apply(() => {});
  assert.equal(bounded.redoStack.length, 100);
  for (let i = 0; i < 100; i++) {
    bounded.redo();
  }
  assert.deepEqual(bounded.color({ x: 0, y: 0 }), [101, 0, 0, 0]);
}
