/** Exercise actual checkpoint debounce boundaries and mounted cancellation without wall-clock sleeps. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DraftWriter,
  SCENE_CHECKPOINT_DEBOUNCE_MS,
  SCENE_CHECKPOINT_FLUSH_INTERVAL_MS,
} from '../../../frontend/project/drafts.mts';
import { EditorLifetime } from '../../../frontend/editor/editor-lifetime.mts';

await test('scene checkpoint debounce coalesces edits, flushes exactly once and stops cleanly', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const writes: Record<string, unknown>[] = [];
  const writer = new DraftWriter(
    (_route, data) => {
      writes.push(data);
      return Promise.resolve({ revision: String(writes.length) });
    },
    () => {},
  );
  const settle = async () => {
    // The timer schedules the serial writer, whose acknowledgement is another microtask.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  try {
    const first = { scene: { cells: ['first'] } };
    writer.observe(first);
    context.mock.timers.tick(SCENE_CHECKPOINT_DEBOUNCE_MS - 1);
    await settle();
    assert.equal(writes.length, 0);
    writer.observe({ scene: { cells: ['second'] } });
    context.mock.timers.tick(1);
    await settle();
    assert.equal(writes.length, 0, 'A newer edit resets the quiet period');
    context.mock.timers.tick(SCENE_CHECKPOINT_DEBOUNCE_MS - 1);
    await settle();
    assert.deepEqual(
      writes.map((w) => w.scene),
      [{ cells: ['second'] }],
    );
    writer.observe({ scene: { cells: ['third'] } });
    await writer.flush();
    context.mock.timers.tick(SCENE_CHECKPOINT_DEBOUNCE_MS);
    await settle();
    assert.equal(writes.length, 2, 'Explicit flush cancels the pending debounce');
    writer.observe({ scene: { cells: ['stopped'] } });
    writer.stop();
    context.mock.timers.tick(SCENE_CHECKPOINT_DEBOUNCE_MS);
    await settle();
    assert.equal(writes.length, 2);
    assert.equal(writer.revision, '2', 'Stopping retains the recoverable checkpoint');
  } finally {
    writer.stop();
    context.mock.timers.reset();
  }
});

await test('mounted periodic work and delayed callbacks cancel on disposal', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const lifetime = new EditorLifetime();
  let calls = 0;
  try {
    lifetime.interval(() => calls++, SCENE_CHECKPOINT_FLUSH_INTERVAL_MS);
    lifetime.timeout(() => calls++, 350);
    context.mock.timers.tick(349);
    assert.equal(calls, 0);
    context.mock.timers.tick(1);
    assert.equal(calls, 1);
    context.mock.timers.tick(SCENE_CHECKPOINT_FLUSH_INTERVAL_MS - 350);
    assert.equal(calls, 2);
    lifetime.timeout(() => calls++, 350);
    lifetime.dispose();
    context.mock.timers.tick(10000);
    assert.equal(calls, 2);
    lifetime.timeout(() => calls++, 0);
    lifetime.interval(() => calls++, 1);
    context.mock.timers.tick(10000);
    assert.equal(calls, 2, 'A disposed lifetime cannot start new scheduled work');
  } finally {
    lifetime.dispose();
    context.mock.timers.reset();
  }
});
