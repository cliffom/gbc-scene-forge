/** Transient paints share the mounted lifetime and never retain a scene snapshot. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorLifetime } from '../../../frontend/editor/editor-lifetime.mts';
import { LayerEditor } from '../../../frontend/scene/layers.mts';
import { decodeLoaded } from '../../../frontend/project/project-contracts.mts';
import { createHoverPaint } from '../../../frontend/editor/editor-rendering.mts';
import { SceneSession } from '../../../frontend/editor/editor-state.mts';

await test('hover paints coalesce, consume current state, cancel and reject replaced scenes', () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  globalThis.requestAnimationFrame = (callback) => {
    frames.set(++next, callback);
    return next;
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };
  const lifetime = new EditorLifetime();
  const session = new SceneSession();
  const scene = {
    width: 1,
    height: 1,
    grid: 8,
    next_layer_id: 2,
    next_object_id: 1,
    layers: [{ id: 1, name: 'Ground', type: 'tilelayer', visible: true, cells: [['']] }],
  };
  const loaded = decodeLoaded({ id: 'first', name: 'First', revision: 'one', scene });
  const editor = () =>
    new LayerEditor(
      {
        width: 1,
        height: 1,
        grid: 8,
        next_layer_id: 2,
        next_object_id: 1,
        layers: loaded.layers,
      },
      [],
      { erase_cell: 'empty' },
    );
  session.editor = editor();
  session.loaded = loaded;
  let hover: number | null = 0;
  const painted: (number | null)[] = [];
  const scheduler = createHoverPaint(lifetime, session, () => painted.push(hover));
  const flush = () => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) {
      callback(0);
    }
  };
  try {
    for (let i = 0; i < 20; i++) {
      hover = i;
      scheduler.request();
    }
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(painted, [19]);
    scheduler.request();
    hover = null; // Pointer leave supersedes the previous outline.
    scheduler.request();
    flush();
    assert.deepEqual(painted, [19, null]);
    scheduler.request();
    scheduler.cancel(); // Immediate authored/selection/animation draw supersedes hover.
    assert.equal(frames.size, 0);
    flush();
    assert.equal(painted.length, 2);
    for (const replace of [
      () => {
        session.editor = editor();
      },
      () => {
        session.loaded = { ...loaded, id: 'second' };
      },
      () => {
        session.loaded = { ...loaded, revision: 'two' };
      },
      () => {
        session.editor = null;
        session.loaded = null;
      },
    ]) {
      scheduler.request();
      replace();
      flush();
      assert.equal(painted.length, 2);
    }
    session.editor = editor();
    session.loaded = { ...loaded, id: 'third', revision: 'three' };
    scheduler.request();
    lifetime.dispose();
    assert.equal(frames.size, 0);
    scheduler.request();
    flush();
    assert.equal(painted.length, 2);
  } finally {
    lifetime.dispose();
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});
