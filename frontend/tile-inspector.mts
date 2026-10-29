import { EditorLifetime } from './editor-lifetime.mts';
/** Shared tileset edits have their own draft history and an explicit project save. */
import type { CollisionShape, TileMetadata } from './tile-metadata.mts';
import { drawCollision, emptyMetadata, terrainColor, validateMetadata } from './tile-metadata.mts';
export interface TileChoice {
  atlas: string;
  group: string;
  asset: string;
  width: number;
  height: number;
  image: HTMLImageElement;
  sx: number;
  sy: number;
}
function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) {
    throw Error(`Missing element ${id}`);
  }
  return found;
}
const input = (id: string) => element(id, HTMLInputElement);
const button = (id: string) => element(id, HTMLButtonElement);
const select = (id: string) => element(id, HTMLSelectElement);
export function createTileInspector(
  metadata: (tile: TileChoice) => TileMetadata | undefined,
  save: (tile: TileChoice, value: TileMetadata) => Promise<void>,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  const dialog = element('tile-dialog', HTMLDialogElement),
    error = element('tile-error', HTMLElement);
  const form = element('tile-form', HTMLFormElement),
    canvas = element('tile-preview', HTMLCanvasElement);
  let choices: TileChoice[] = [],
    tile: TileChoice | null = null,
    value = emptyMetadata(),
    initial = '';
  let undo: TileMetadata[] = [],
    redo: TileMetadata[] = [],
    selected: number | null = null,
    saving = false;
  function render() {
    if (lifetime.disposed) {
      return;
    }
    if (!tile) {
      return;
    }
    input('tile-terrain').value = value.terrain;
    input('tile-solid').checked = value.solid;
    select('tile-shapes').replaceChildren(
      ...value.shapes.map(
        (shape) =>
          new Option(
            `#${shape.id} · ${shape.kind}`,
            String(shape.id),
            false,
            shape.id === selected,
          ),
      ),
    );
    const shape = value.shapes.find((shape) => shape.id === selected);
    const polygon = shape?.kind === 'polygon';
    element('tile-shape-bounds', HTMLElement).hidden = !shape || polygon;
    element('tile-polygon-field', HTMLElement).hidden = !polygon;
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      input(`tile-${key}`).disabled = saving || !shape || polygon;
      input(`tile-${key}`).value = String(shape && shape.kind !== 'polygon' ? shape[key] : 0);
    }
    element('tile-points', HTMLTextAreaElement).disabled = saving || !polygon;
    element('tile-points', HTMLTextAreaElement).value =
      shape?.kind === 'polygon' ? shape.points.map((p) => p.join(',')).join(' ') : '';
    select('tile-cell').disabled = saving || JSON.stringify(value) !== initial;
    for (const control of form.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >('button, input, select, textarea')) {
      if (saving) {
        control.disabled = true;
      }
    }
    button('tile-save').disabled = saving;
    button('tile-cancel').disabled = saving;
    button('tile-add-shape').disabled = saving || value.shapes.length >= 32;
    button('tile-remove-shape').disabled = saving || !shape;
    button('tile-undo').disabled = saving || !undo.length;
    button('tile-redo').disabled = saving || !redo.length;
    select('tile-shapes').disabled = saving || !value.shapes.length;
    select('tile-shape-kind').disabled =
      input('tile-terrain').disabled =
      input('tile-solid').disabled =
        saving;
    canvas.width = tile.width;
    canvas.height = tile.height;
    const scale = Math.max(1, Math.min(24, Math.floor(256 / Math.max(tile.width, tile.height))));
    canvas.style.width = `${tile.width * scale}px`;
    canvas.style.height = `${tile.height * scale}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw Error('Canvas rendering unavailable.');
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      tile.image,
      tile.sx,
      tile.sy,
      tile.width,
      tile.height,
      0,
      0,
      tile.width,
      tile.height,
    );
    if (value.terrain) {
      ctx.fillStyle = terrainColor(value.terrain);
      ctx.fillRect(0, 0, tile.width, tile.height);
    }
    drawCollision(ctx, value, tile.width, tile.height);
  }
  function commit(next: TileMetadata) {
    if (!tile) {
      return;
    }
    validateMetadata(next, tile.width, tile.height);
    if (JSON.stringify(next) !== JSON.stringify(value)) {
      undo.push(structuredClone(value));
      if (undo.length > 100) {
        undo.shift();
      }
      redo = [];
      value = next;
    }
    error.textContent = '';
    render();
  }
  function readFields() {
    const next = structuredClone(value);
    next.terrain = input('tile-terrain').value;
    next.solid = input('tile-solid').checked;
    const shape = next.shapes.find((shape) => shape.id === selected);
    if (shape?.kind === 'polygon') {
      const raw = element('tile-points', HTMLTextAreaElement).value.trim();
      shape.points = raw
        ? raw.split(/\s+/).map((pair): [number, number] => {
            const parts = pair.split(',');
            if (parts.length !== 2 || parts.some((part) => !part.trim())) {
              throw Error('Use x,y pairs separated by spaces.');
            }
            return [Number(parts[0]), Number(parts[1])];
          })
        : [];
    } else if (shape) {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        const raw = input(`tile-${key}`).value;
        if (!raw.trim()) {
          throw Error('Enter whole-pixel shape bounds.');
        }
        shape[key] = Number(raw);
      }
    }
    commit(next);
  }
  function attempt(work: () => void) {
    if (saving) {
      return;
    }
    try {
      work();
    } catch (cause) {
      if (lifetime.disposed) {
        return;
      }
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    }
  }
  for (const id of [
    'tile-terrain',
    'tile-solid',
    'tile-x',
    'tile-y',
    'tile-width',
    'tile-height',
  ]) {
    lifetime.assign(input(id), 'onchange', () => attempt(readFields));
  }
  lifetime.assign(element('tile-points', HTMLTextAreaElement), 'onchange', () =>
    attempt(readFields),
  );
  lifetime.assign(select('tile-shapes'), 'onchange', () =>
    attempt(() => {
      const id = Number(select('tile-shapes').value);
      readFields();
      selected = id;
      render();
    }),
  );
  lifetime.assign(button('tile-add-shape'), 'onclick', () =>
    attempt(() => {
      readFields();
      if (!tile) {
        return;
      }
      const next = structuredClone(value),
        kind = select('tile-shape-kind').value;
      let shape: CollisionShape;
      if (kind === 'polygon') {
        shape = {
          id: next.next_shape_id,
          kind,
          points: [
            [0, tile.height],
            [tile.width, tile.height],
            [tile.width, 0],
          ],
        };
      } else if (kind === 'rectangle' || kind === 'ellipse') {
        shape = {
          id: next.next_shape_id,
          kind,
          x: 0,
          y: 0,
          width: tile.width,
          height: tile.height,
        };
      } else {
        throw Error('Unknown collision shape.');
      }
      selected = shape.id;
      next.next_shape_id++;
      next.shapes.push(shape);
      next.solid = true;
      commit(next);
    }),
  );
  lifetime.assign(button('tile-remove-shape'), 'onclick', () =>
    attempt(() => {
      const next = structuredClone(value);
      next.shapes = next.shapes.filter((shape) => shape.id !== selected);
      selected = next.shapes[0]?.id ?? null;
      commit(next);
    }),
  );
  lifetime.assign(button('tile-undo'), 'onclick', () =>
    attempt(() => {
      const old = undo.pop();
      if (old) {
        redo.push(value);
        value = old;
        selected = value.shapes[0]?.id ?? null;
        error.textContent = '';
        render();
      }
    }),
  );
  lifetime.assign(button('tile-redo'), 'onclick', () =>
    attempt(() => {
      const next = redo.pop();
      if (next) {
        undo.push(value);
        value = next;
        selected = value.shapes[0]?.id ?? null;
        render();
      }
    }),
  );
  function choose(index: number) {
    tile = choices[index];
    if (!tile) {
      throw Error('Choose a tile.');
    }
    value = structuredClone(metadata(tile) || emptyMetadata());
    initial = JSON.stringify(value);
    undo = [];
    redo = [];
    selected = value.shapes[0]?.id ?? null;
    error.textContent = '';
    element('tile-identity', HTMLElement).textContent =
      `${tile.asset} · ${tile.width} × ${tile.height}px · ${tile.group === 'sprites' ? 'Sprite tileset' : `${tile.group}px tileset`}`;
    render();
  }
  lifetime.assign(select('tile-cell'), 'onchange', () =>
    attempt(() => choose(Number(select('tile-cell').value))),
  );
  lifetime.assign(form, 'onsubmit', async (event) => {
    event.preventDefault();
    if (saving || !tile) {
      return;
    }
    try {
      readFields();
      saving = true;
      render();
      await save(tile, structuredClone(value));
      dialog.close();
    } catch (cause) {
      if (lifetime.disposed) {
        return;
      }
      error.textContent = cause instanceof Error ? cause.message : String(cause);
    } finally {
      saving = false;
      render();
    }
  });
  lifetime.assign(button('tile-cancel'), 'onclick', () => {
    if (!saving) {
      dialog.close();
    }
  });
  lifetime.assign(dialog, 'oncancel', (event) => {
    if (saving) {
      event.preventDefault();
    }
  });
  return {
    open(options: TileChoice[]) {
      if (!options.length) {
        return;
      }
      choices = options;
      select('tile-cell').replaceChildren(
        ...options.map((option, i) => new Option(option.asset, String(i))),
      );
      choose(0);
      dialog.showModal();
      input('tile-terrain').focus();
    },
  };
}
