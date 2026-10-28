/** Checkpoint races, retries and cleanup must preserve the most recent authored edits. */
import assert from 'node:assert/strict';
import { DraftWriter } from '../frontend/drafts.mts';

const calls: { route: string; data: Record<string, unknown> }[] = [];
const messages: string[] = [];
let release: (() => void) | undefined;
let block = false;
let fail = false;
const writer = new DraftWriter(
  async (route, data) => {
    calls.push({ route, data });
    if (block) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    if (fail) {
      throw Error('disk full');
    }
    return { revision: `revision-${calls.length}` };
  },
  (message) => messages.push(message),
);
writer.observe({ scene: 'first' });
block = true;
const first = writer.flush();
await Promise.resolve();
writer.observe({ scene: 'second' });
block = false;
release?.();
await first;
await writer.flush();
assert.equal(calls[1].data.scene, 'second');
assert.equal(calls[1].data.revision, 'revision-1');
fail = true;
writer.observe({ scene: 'third' });
await writer.flush();
assert(messages.at(-1)?.includes('disk full'));
fail = false;
await writer.flush();
assert.equal(calls.at(-1)?.data.scene, 'third');
assert.equal(calls.at(-1)?.data.revision, 'revision-2');
// Successful save/discard waits for the in-flight acknowledgement before removal.
block = true;
writer.observe({ scene: 'fourth' });
const fourth = writer.flush();
await Promise.resolve();
const clear = writer.clear();
block = false;
release?.();
await fourth;
await clear;
assert.equal(calls.at(-1)?.route, 'delete-draft');
assert.equal(calls.at(-1)?.data.revision, 'revision-5');
writer.observe({ scene: 'must not recreate' });
await writer.flush();
assert.equal(calls.at(-1)?.route, 'delete-draft');
assert.equal(writer.revision, null);
// Undo to the saved baseline clears only this writer's checkpoint.
const other = new DraftWriter(
  async (route, data) => {
    calls.push({ route, data });
    return Promise.resolve({ revision: 'other' });
  },
  () => {},
);
assert.notEqual(other.id, writer.id);
other.observe({ scene: 'edit' });
await other.flush();
other.observe(null);
await other.flush();
assert.equal(calls.at(-1)?.route, 'delete-draft');
assert.equal(calls.at(-1)?.data.id, other.id);
await other.clear();
console.log('Draft checkpoint ordering, retries, tab isolation and cleanup passed.');
