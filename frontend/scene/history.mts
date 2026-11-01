/** Ephemeral bidirectional history. Persistent scene/draft formats stay unchanged. */
export interface HistoryChange {
  path: string[];
  before: unknown;
  after: unknown;
  beforeExists: boolean;
  afterExists: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/** Compare plain scene trees; length-changing arrays are atomic replacements. */
export function historyDiff(before: unknown, after: unknown): HistoryChange[] {
  const changes: HistoryChange[] = [];
  function visit(a: unknown, b: unknown, path: string[], ae = true, be = true) {
    if (a === b && (ae === be || a === undefined)) {
      return;
    }
    if (
      ae &&
      be &&
      record(a) &&
      record(b) &&
      Array.isArray(a) === Array.isArray(b) &&
      (!Array.isArray(a) || (Array.isArray(b) && a.length === b.length))
    ) {
      if (Array.isArray(a) && Array.isArray(b)) {
        // Tile rows dominate dense strokes. Choose a row before allocating leaf records.
        if (
          a.every((value) => typeof value === 'string') &&
          b.every((value) => typeof value === 'string')
        ) {
          const count = a.reduce<number>(
            (total, value, index) => total + Number(value !== b[index]),
            0,
          );
          if (
            count > 3 &&
            count * (JSON.stringify(path).length + 100) > JSON.stringify([a, b]).length
          ) {
            changes.push({
              path: [...path],
              before: [...a],
              after: [...b],
              beforeExists: true,
              afterExists: true,
            });
            return;
          }
        }
        const start = changes.length;
        let touched = 0;
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) {
            const count = changes.length;
            path.push(String(i));
            visit(a[i], b[i], path);
            path.pop();
            if (changes.length > count) {
              touched++;
            }
          }
        }
        // Dense edits use one subtree replacement when leaf paths cost more.
        if (
          touched > a.length / 2 &&
          changes.length - start > 3 &&
          JSON.stringify(changes.slice(start)).length > JSON.stringify([a, b]).length
        ) {
          changes.splice(start, changes.length - start, {
            path: [...path],
            before: structuredClone(a),
            after: structuredClone(b),
            beforeExists: true,
            afterExists: true,
          });
        }
        return;
      }
      // Dirty snapshots use JSON order. Replacing a shape-changing object preserves it.
      const leftKeys = Object.keys(a).filter((key) => a[key] !== undefined);
      const rightKeys = Object.keys(b).filter((key) => b[key] !== undefined);
      if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
        changes.push({
          path: [...path],
          before: structuredClone(a),
          after: structuredClone(b),
          beforeExists: true,
          afterExists: true,
        });
        return;
      }
      const left = a;
      const right = b;
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        path.push(key);
        visit(left[key], right[key], path, Object.hasOwn(left, key), Object.hasOwn(right, key));
        path.pop();
      }
    } else {
      changes.push({
        path: [...path],
        before: structuredClone(a),
        after: structuredClone(b),
        beforeExists: ae,
        afterExists: be,
      });
    }
  }
  visit(before, after, []);
  return changes;
}

/** Clone only retained payloads; no history entry shares mutable data with the scene. */
export function historyApply<T>(
  scene: T,
  changes: HistoryChange[],
  direction: 'before' | 'after',
): T {
  for (const change of changes) {
    if (!change.path.length) {
      const value: unknown = structuredClone(change[direction]);
      if (!record(scene) || !record(value)) {
        throw Error('Invalid scene history root.');
      }
      for (const key of Object.keys(scene)) {
        delete scene[key];
      }
      Object.assign(scene, value);
      continue;
    }
    let target: unknown = scene;
    for (const key of change.path.slice(0, -1)) {
      if (!record(target)) {
        throw Error('Invalid scene history path.');
      }
      target = target[key];
    }
    const key = change.path.at(-1);
    if (!record(target) || key === undefined) {
      throw Error('Invalid scene history target.');
    }
    if (change[direction === 'before' ? 'beforeExists' : 'afterExists']) {
      target[key] = structuredClone(change[direction]);
    } else {
      delete target[key];
    }
  }
  return scene;
}

/** UI context lives outside authored edits but snapshot undo historically restored it. */
export function captureHistoryContext(
  changes: HistoryChange[],
  scene: object,
  keys: string[],
  direction: 'before' | 'after',
) {
  if (!record(scene)) {
    return;
  }
  for (const key of keys) {
    let change = changes.find((change) => change.path.length === 1 && change.path[0] === key);
    if (!change) {
      change = {
        path: [key],
        before: undefined,
        after: undefined,
        beforeExists: false,
        afterExists: false,
      };
      changes.push(change);
    }
    change[direction] = structuredClone(scene[key]);
    change[direction === 'before' ? 'beforeExists' : 'afterExists'] = Object.hasOwn(scene, key);
  }
}
