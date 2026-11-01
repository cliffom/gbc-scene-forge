/** Observational history comparison. Run: node tests/support/profile_history.mjs */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const baseline = resolve('build/scalability/baseline-model.mts');
if (!process.argv[2]) {
  mkdirSync('build/scalability', { recursive: true });
  writeFileSync(baseline, readFileSync('tests/fixtures/rendering-baseline/model.txt', 'utf8'));
  for (const scene of ['small', 'large', 'wide']) {
    for (const operation of ['cell', 'stroke', 'property']) {
      for (const mode of ['before', 'after']) {
        process.stdout.write(
          execFileSync(process.execPath, [
            '--expose-gc',
            import.meta.filename,
            scene,
            operation,
            mode,
          ]),
        );
      }
    }
  }
} else {
  const [label, operation, mode] = process.argv.slice(2);
  const [w, h, layers] = { small: [16, 12, 3], large: [128, 96, 8], wide: [480, 9, 8] }[label];
  const { Editor } = await import(
    pathToFileURL(mode === 'before' ? baseline : resolve('frontend/scene/model.mts')).href
  );
  global.gc();
  const editor = new Editor(
    {
      width: w,
      height: h,
      layers: Array.from({ length: layers }, (_, id) => ({
        id,
        cells: Array.from({ length: h }, () => Array(w).fill('terrain/earth/0/0')),
      })),
      objects: [{ id: 1, name: 'A', properties: [] }],
    },
    [],
    { erase_cell: 'empty' },
  );
  // Warm class/clone paths before the retained-history measurement.
  for (let i = 0; i < 20; i++) {
    editor.change((scene) => {
      scene.objects[0].name = `warm ${i}`;
    });
  }
  editor.undoStack = [];
  editor.redoStack = [];
  global.gc();
  const startHeap = process.memoryUsage().heapUsed;
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    editor.change((scene) => {
      if (operation === 'property') scene.objects[0].name = String(i);
      else
        for (let j = 0; j < (operation === 'stroke' ? Math.min(w * h, 1000) : 1); j++)
          scene.layers[0].cells[Math.floor(j / w)][j % w] = String(i);
    });
    samples.push(performance.now() - start);
  }
  global.gc();
  const heap = process.memoryUsage().heapUsed - startHeap;
  const payload = JSON.stringify(editor.undoStack).length;
  const startUndo = performance.now();
  for (let i = 0; i < 100; i++) editor.undo();
  const undoMs = (performance.now() - startUndo) / 100;
  const startRedo = performance.now();
  for (let i = 0; i < 100; i++) editor.redo();
  const redoMs = (performance.now() - startRedo) / 100;
  samples.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      label,
      operation,
      mode,
      heap,
      payload,
      editMedian: samples[50],
      editP95: samples[95],
      undoMs,
      redoMs,
    }),
  );
}
