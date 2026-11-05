/** Checkpoint races, retries and cleanup must preserve the most recent authored edits. */
import assert from 'node:assert/strict';
import { DraftWriter } from '../../../frontend/project/drafts.mts';
import { HttpError } from '../../../frontend/shared/errors.mts';

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

// Completed observations own their bytes. Neither a caller mutation nor a later
// transient refresh may silently change an in-flight/idempotent payload.
const captured: Record<string, unknown>[] = [];
const immutable = new DraftWriter(
  async (_route, data) => {
    captured.push(data);
    return Promise.resolve({ revision: 'captured' });
  },
  () => {},
);
const observed = { scene: { cells: ['first'] } };
immutable.observe(observed);
observed.scene.cells[0] = 'later';
await immutable.flush();
assert.deepEqual(captured[0].scene, { cells: ['first'] });
immutable.observe(observed);
await immutable.flush();
assert.deepEqual(captured[1].scene, { cells: ['later'] });
immutable.stop();

// One encoding per observation, independent of how large the previous scene is.
const counting = new DraftWriter(
  () => Promise.resolve({ revision: 'counted' }),
  () => {},
);
const stringifyBefore = JSON.stringify;
let observationEncodes = 0;
JSON.stringify = new Proxy(stringifyBefore, {
  apply(target, receiver, args) {
    observationEncodes++;
    const result: unknown = Reflect.apply(target, receiver, args);
    return result;
  },
});
try {
  counting.observe({ scene: { cells: ['same'] } });
  counting.observe({ scene: { cells: ['same'] } });
  assert.equal(observationEncodes, 2);
} finally {
  JSON.stringify = stringifyBefore;
  counting.stop();
}

// Keeping a scene replays an uncertain old write, then confirms the latest edit.
const keptCalls: { route: string; data: Record<string, unknown> }[] = [];
let keepOffline = true;
const kept = new DraftWriter(
  (route, data) => {
    keptCalls.push({ route, data });
    if (keepOffline) {
      return Promise.reject(Error('offline'));
    }
    return Promise.resolve({ revision: `kept-${keptCalls.length}` });
  },
  () => {},
);
kept.observe({ scene: 'old uncertain bytes' });
await kept.flush();
kept.observe({ scene: 'latest bytes' });
await assert.rejects(kept.keep(), /Could not confirm/);
keepOffline = false;
await kept.keep();
assert.equal(keptCalls.at(-2)?.data.scene, 'old uncertain bytes');
assert.equal(keptCalls.at(-1)?.data.scene, 'latest bytes');
assert(!keptCalls.some((call) => call.route === 'delete-draft'));
const keptCount = keptCalls.length;
kept.observe({ scene: 'released editor' });
await kept.flush();
assert.equal(keptCalls.length, keptCount);

// A later cleanup failure can occur after our checkpoint was already deleted.
// Resuming must persist subsequent work, including identical authored bytes.
const resumedCalls: string[] = [];
const resumed = new DraftWriter(
  (route) => {
    resumedCalls.push(route);
    return Promise.resolve({ revision: `resumed-${resumedCalls.length}` });
  },
  () => {},
);
resumed.observe({ scene: 'retained' });
await resumed.flush();
await resumed.clear();
resumed.resume();
resumed.observe({ scene: 'retained' });
await resumed.keep();
assert.deepEqual(resumedCalls, ['checkpoint-draft', 'delete-draft', 'checkpoint-draft']);
