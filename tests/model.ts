import type { ApplyJob, Scene } from '../frontend/types.ts';
import assert from 'node:assert/strict';
import { Editor, canvasPoint } from '../frontend/model.mts';
import { duration, progressView } from '../frontend/progress.mts';

const scene: Scene = {
  version: 1,
  connector: 'test',
  id: 'scene',
  name: 'Scene',
  source_digest: 'revision',
  profile: 'settlement',
  width: 6,
  height: 4,
  cells: Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => 'terrain:earth')),
  references: [],
};
const editor = new Editor(scene, [[0, 0]], { erase_cell: 'terrain:earth' });
assert.deepEqual(
  canvasPoint(
    { clientX: 114, clientY: 78 },
    { left: 50, top: 30, width: 192, height: 128 },
    48,
    32,
  ),
  { x: 16, y: 12 },
);
editor.begin();
editor.stamp(1, 1, [['terrain:scrub']]);
editor.stamp(2, 1, [['terrain:scrub']]);
editor.end();
assert.equal(editor.undoStack.length, 1);
editor.undo();
assert.equal(editor.scene.cells[1][1], 'terrain:earth');
editor.redo();
assert.equal(editor.scene.cells[1][2], 'terrain:scrub');
assert.equal(scene.cells[1][1], 'terrain:earth');
const before = JSON.stringify(editor.scene);
assert.throws(() => editor.stamp(0, 0, [['terrain:water', 'terrain:water']]));
assert.equal(JSON.stringify(editor.scene), before);
assert.throws(() => editor.stamp(5, 1, [['terrain:water', 'terrain:water']]));
assert.equal(JSON.stringify(editor.scene), before);
editor.move({ x: 1, y: 1, w: 2, h: 1 }, 1, 0);
assert.equal(editor.scene.cells[1][1], 'terrain:earth');
assert.equal(editor.scene.cells[1][2], 'terrain:scrub');
assert.equal(editor.scene.cells[1][3], 'terrain:scrub');
editor.undo();
assert.equal(editor.scene.cells[1][1], 'terrain:scrub');
editor.fill(0, 1, 'terrain:water');
assert.equal(editor.scene.cells[0][0], 'terrain:earth');
assert.equal(editor.scene.cells[0][1], 'terrain:water');
assert.equal(editor.scene.cells[1][1], 'terrain:scrub');
editor.begin();
editor.stamp(4, 2, [['terrain:masonry']]);
editor.cancel();
assert.equal(editor.scene.cells[2][4], 'terrain:water');
editor.undo();
editor.stamp(5, 3, [['terrain:water']]);
assert.equal(editor.redoStack.length, 0);
console.log(
  'Scene editing: coordinates, atomic stamps, stroke history, overlapping moves, flood fill and cancellation pass.',
);
const job: ApplyJob = {
  status: 'running',
  step: 'Running campaign and graphics checks',
  activity: 'Playing through the full campaign',
  started_at: 100,
  phase_started_at: 120,
  step_index: 4,
  step_count: 5,
  last_output_at: 149,
  process: { running: true },
};
assert.equal(duration(65), '1m 05s');
assert.equal(duration(-10), '0s');
assert.equal(progressView(job, 150).state, 'running');
assert.equal(progressView(job, 180).state, 'quiet');
assert.match(progressView(job, 180).detail, /Process running/);
assert.match(progressView(job, 180).detail, /Step 4 of 5/);
assert.equal(progressView(job, 180, 'Failed to fetch').state, 'disconnected');
assert.match(progressView(job, 180, 'Failed to fetch').activity, /may still be running/);
assert.equal(progressView({ ...job, status: 'failed', error: 'Exit code 7' }, 180).state, 'failed');
assert.equal(progressView({ ...job, status: 'complete', ended_at: 160 }, 200).state, 'complete');
assert.match(
  progressView({ ...job, status: 'complete', ended_at: 160 }, 200).detail,
  /Elapsed 1m 00s/,
);
console.log(
  'Task feedback: elapsed time, quiet live process, failures and disconnection states pass.',
);
