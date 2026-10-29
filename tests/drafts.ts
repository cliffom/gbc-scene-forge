/** Checkpoint races, retries and cleanup must preserve the most recent authored edits. */
import assert from 'node:assert/strict';
import { DraftWriter } from '../frontend/project/drafts.mts';
import { HttpError } from '../frontend/shared/errors.mts';

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
// A size rejection must not pin an oversized snapshot after the author reduces it.
const rejectedCalls: Record<string, unknown>[] = [];
const rejected = new DraftWriter(
  async (_route, data) => {
    rejectedCalls.push(data);
    if (data.scene === 'oversized') {
      throw new HttpError('Draft exceeds 4 MiB', 400);
    }
    return Promise.resolve({ revision: 'smaller' });
  },
  () => {},
);
rejected.observe({ scene: 'oversized' });
await rejected.flush();
rejected.observe({ scene: 'smaller' });
await rejected.flush();
assert.equal(rejectedCalls.at(-1)?.scene, 'smaller');
assert.equal(rejected.revision, 'smaller');
await rejected.clear();
// A lost acknowledgement still requires replaying the old payload before newer edits.
for (const failure of [Error('response lost'), new HttpError('server failure', 500)]) {
  const uncertainCalls: Record<string, unknown>[] = [];
  const uncertain = new DraftWriter(
    async (_route, data) => {
      uncertainCalls.push(data);
      if (uncertainCalls.length === 1) {
        throw failure;
      }
      return Promise.resolve({ revision: `ack-${uncertainCalls.length}` });
    },
    () => {},
  );
  uncertain.observe({ scene: 'unacknowledged' });
  await uncertain.flush();
  uncertain.observe({ scene: 'newer' });
  await uncertain.flush();
  assert.deepEqual(uncertainCalls[1], uncertainCalls[0]);
  await uncertain.flush();
  assert.equal(uncertainCalls[2].scene, 'newer');
  assert.equal(uncertainCalls[2].revision, 'ack-2');
  await uncertain.clear();
}
console.log('Draft checkpoint ordering, retries, tab isolation and cleanup passed.');

// Model the server's revision guards, idempotent replay and cross-tab removal.
const stored = new Map<string, { revision: string; scene: unknown }>();
let loseResponse = false;
let offline = false;
let serial = 0;
const lifecycleCalls: { route: string; data: Record<string, unknown> }[] = [];
async function sendLifecycle(route: string, data: Record<string, unknown>) {
  lifecycleCalls.push({ route, data });
  if (offline) {
    throw Error('offline');
  }
  if (route === 'list-drafts') {
    return Promise.resolve({ drafts: [...stored.keys()].map((id) => ({ id })) });
  }
  const id = String(data.id);
  const existing = stored.get(id);
  if (route === 'delete-draft') {
    if (existing && existing.revision !== data.revision) {
      throw new HttpError('newer checkpoint preserved', 409);
    }
    stored.delete(id);
    return Promise.resolve({ deleted: id });
  }
  if ((existing?.revision ?? null) !== data.revision && existing?.scene !== data.scene) {
    throw new HttpError('newer checkpoint preserved', 409);
  }
  const revision =
    existing && existing.scene === data.scene ? existing.revision : `stored-${++serial}`;
  stored.set(id, { revision, scene: data.scene });
  if (loseResponse) {
    loseResponse = false;
    throw Error('acknowledgement lost');
  }
  return Promise.resolve({ revision });
}
const live = new DraftWriter(sendLifecycle, () => {});
live.observe({ scene: 'initial' });
await live.flush();
const removedId = live.id;
stored.delete(removedId); // Another tab restores, then saves or reverts this draft.
live.observe({ scene: 'new work' });
await live.flush();
assert.notEqual(live.id, removedId);
assert.equal(stored.get(live.id)?.scene, 'new work');
// An existing newer checkpoint must keep its identity and content on conflict.
const liveId = live.id;
stored.set(liveId, { revision: 'external', scene: 'external work' });
live.observe({ scene: 'conflicting work' });
await live.flush();
assert.equal(live.id, liveId);
assert.deepEqual(stored.get(liveId), { revision: 'external', scene: 'external work' });
await assert.rejects(live.clear(), /newer checkpoint preserved/);
stored.clear();

// Cleanup resolves uncertain first and subsequent writes before guarded deletion.
for (const firstWrite of [true, false]) {
  const cleanup = new DraftWriter(sendLifecycle, () => {});
  if (!firstWrite) {
    cleanup.observe({ scene: 'acknowledged' });
    await cleanup.flush();
  }
  cleanup.observe({ scene: 'discard me' });
  loseResponse = true;
  await cleanup.flush();
  const failedWrite = lifecycleCalls.at(-1);
  assert.equal(stored.get(cleanup.id)?.scene, 'discard me');
  cleanup.observe({ scene: 'newer unsent work' });
  offline = true;
  await assert.rejects(cleanup.clear(), /offline/);
  assert(stored.has(cleanup.id));
  offline = false;
  await cleanup.clear();
  assert.deepEqual(lifecycleCalls.at(-2), failedWrite);
  assert.equal(lifecycleCalls.at(-1)?.route, 'delete-draft');
  assert.equal(stored.has(cleanup.id), false);
  await cleanup.flush();
  assert.equal(stored.size, 0);
}
console.log('Draft cross-tab deletion recovery and unacknowledged-write cleanup passed.');
