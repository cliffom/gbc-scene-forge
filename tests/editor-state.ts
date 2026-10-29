/** Public state and resource contracts: no DOM or network is acquired by imports. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { DraftWriter } from '../frontend/drafts.mts';
import { EditorLifetime } from '../frontend/editor-lifetime.mts';
import { ExternalRefreshState } from '../frontend/editor-refresh-state.mts';
import { SceneSession, WorkspaceState } from '../frontend/editor-state.mts';
import { LayerEditor } from '../frontend/layers.mts';
import { decodeLoaded, decodeProject } from '../frontend/project-contracts.mts';
import { ProjectApi } from '../frontend/project-api.mts';
import { mountProjectEditor } from '../frontend/project-editor.mts';

const saved = () =>
  decodeLoaded({
    id: 'room',
    name: 'Room',
    revision: 'scene-a',
    scene: {
      width: 2,
      height: 1,
      grid: 8,
      next_layer_id: 2,
      next_object_id: 1,
      layers: [
        { id: 1, name: 'Ground', type: 'tilelayer', visible: true, cells: [['', 'terrain/stone']] },
      ],
    },
  });
function session() {
  const scene = new SceneSession();
  scene.loaded = scene.committed = saved();
  scene.editor = new LayerEditor(
    {
      width: 2,
      height: 1,
      grid: 8,
      layers: scene.loaded.layers,
      next_layer_id: 2,
      next_object_id: 1,
    },
    [],
    { erase_cell: 'empty' },
  );
  scene.baseline = scene.snapshot();
  return scene;
}
await test('composition imports without acquiring a DOM; scene serialization preserves the wire contract', () => {
  assert.equal(typeof mountProjectEditor, 'function');
  const scene = session();
  assert.equal(scene.dirty(), false);
  const layer = scene.serialize().layers[0];
  assert.equal('cells' in layer && layer.cells[0][0], '');
  scene.editor?.stamp(0, 0, [['terrain/earth']]);
  assert.equal(scene.dirty(), true);
  assert.equal(
    scene.committed?.layers[0].type === 'tilelayer' && scene.committed.layers[0].cells[0][0],
    'empty',
  );
  scene.editor?.undo();
  assert.equal(scene.dirty(), false);
  assert.throws(
    () => decodeLoaded({ ...saved(), scene: { width: 2, height: 1, grid: 8, layers: [] } }),
    /Invalid scene/,
  );
  assert.throws(() => decodeProject({ atlases: [], id: 'p' }), /JSON object/);
});
await test('refresh fence survives animation snapshots but rejects scene, editor, revision or interaction changes', () => {
  const scene = session(),
    workspace = new WorkspaceState(),
    fence = new ExternalRefreshState();
  workspace.revision = 'project-a';
  const before = fence.capture(scene, workspace);
  scene.loaded = { ...saved() };
  assert.equal(fence.matches(before, scene, workspace), true);
  for (const loaded of [
    { ...saved(), id: 'other' },
    { ...saved(), revision: 'scene-b' },
  ]) {
    scene.loaded = loaded;
    assert.equal(fence.matches(before, scene, workspace), false);
  }
  scene.loaded = saved();
  workspace.revision = 'project-b';
  assert.equal(fence.matches(before, scene, workspace), false);
  workspace.revision = 'project-a';
  scene.editor = session().editor;
  assert.equal(fence.matches(before, scene, workspace), false);
  scene.editor = before.editor;
  fence.epoch++;
  assert.equal(fence.matches(before, scene, workspace), false);
});
await test('disposal stops timers/listeners, restores handlers once and preserves replacement bindings', async () => {
  const scope = new EditorLifetime(),
    target = new EventTarget();
  let calls = 0,
    cleanups = 0;
  const original = () => -1,
    handler = { onclick: original };
  scope.assign(handler, 'onclick', () => 1);
  scope.assign(handler, 'onclick', () => 2);
  assert.equal(handler.onclick(), 2);
  target.addEventListener('change', () => calls++, { signal: scope.signal });
  scope.timeout(() => calls++, 5);
  scope.interval(() => calls++, 5);
  scope.cleanup(() => cleanups++);
  scope.dispose();
  scope.dispose();
  target.dispatchEvent(new Event('change'));
  await delay(20);
  assert.equal(calls, 0);
  assert.equal(cleanups, 1);
  assert.equal(handler.onclick, original);
  const next = new EditorLifetime();
  next.assign(handler, 'onclick', () => 3);
  assert.equal(handler.onclick(), 3);
  scope.dispose();
  assert.equal(handler.onclick(), 3);
  next.dispose();
  assert.equal(handler.onclick, original);
});
await test('transport preserves project paths, mutation tokens, HTTP errors and palette preflight findings', async () => {
  const realFetch = globalThis.fetch,
    scope = new EditorLifetime();
  const client = new ProjectApi('/projects/demo', scope.signal);
  client.token = 'mutation-token';
  const requests: { url: string; options: RequestInit | undefined }[] = [];
  let status = 200,
    body: unknown = { revision: 'exact-project-a' };
  globalThis.fetch = (input, options) => {
    requests.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      options,
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  try {
    const decode = (value: unknown) => {
      assert.deepEqual(value, { revision: 'exact-project-a' });
      return 'validated';
    };
    assert.equal(await client.json('save-scene', decode, { revision: 'scene-a' }), 'validated');
    assert.equal(requests[0].url, '/projects/demo/api/save-scene');
    assert.deepEqual(requests[0].options?.headers, {
      'Content-Type': 'application/json',
      'X-Scene-Token': 'mutation-token',
    });
    assert.equal(requests[0].options?.body, JSON.stringify({ revision: 'scene-a' }));
    status = 422;
    body = { error: 'over budget' };
    assert.equal((await client.request('palette-preflight', {})).status, 422);
    await assert.rejects(client.json('save-scene', decode, {}), /over budget/);
    status = 200;
    body = { bad: true };
    await assert.rejects(client.json('project', decodeProject), /JSON object/);
    await client.request('project', undefined, 30000, '');
    assert.equal(requests.at(-1)?.url, '/api/project');
    assert.deepEqual(requests.at(-1)?.options?.headers, {});
    scope.dispose();
    await assert.rejects(client.json('project', decodeProject), /abort/i);
  } finally {
    globalThis.fetch = realFetch;
    scope.dispose();
  }
});

await test('stopping a replaced checkpoint writer preserves its saved draft', async () => {
  const routes: string[] = [];
  const writer = new DraftWriter(
    (route) => {
      routes.push(route);
      return Promise.resolve({ revision: 'checkpoint-a' });
    },
    () => {},
  );
  writer.observe({ scene: 'original' });
  await writer.flush();
  writer.observe({ scene: 'newer' });
  const queued = writer.flush();
  writer.stop();
  await queued;
  writer.observe(null);
  await writer.flush();
  assert.deepEqual(routes, ['checkpoint-draft']);
  assert.equal(writer.revision, 'checkpoint-a');
});
