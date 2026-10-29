/** Immutable clipboard snapshots and atomic, validated multi-layer placement. */
import type { LayerEditor, LayerScene, SceneLayer } from './layers.mts';
import { tileParts, transformCell } from './tile-transform.mts';
import type { Selection } from './types.ts';
export interface Composition {
  project: string;
  slots: number[];
  scene: LayerScene;
}
export interface CompositionSelection {
  rectangle: Selection | null;
  objects: Set<string>;
  allLayers: boolean;
}
function selectedLayers(editor: LayerEditor, selection: CompositionSelection) {
  return selection.allLayers ? editor.layers.filter((l) => l.visible) : [editor.active];
}
export function capture(editor: LayerEditor, selection: CompositionSelection, project: string) {
  if (!selection.allLayers) {
    editor.editable();
  }
  const grid = editor.scene.grid;
  const layers = selectedLayers(editor, selection);
  const rect = selection.rectangle;
  const objects = layers.flatMap((l) =>
    l.type === 'objectgroup'
      ? l.objects.filter((o) =>
          rect
            ? o.x >= rect.x * grid &&
              o.x < (rect.x + rect.w) * grid &&
              o.y >= rect.y * grid &&
              o.y < (rect.y + rect.h) * grid
            : selection.objects.has(o.id),
        )
      : [],
  );
  if (!rect && !objects.length) {
    throw Error('Select tiles or objects first.');
  }
  const x = rect?.x ?? Math.floor(Math.min(...objects.map((o) => o.x)) / grid);
  const y = rect?.y ?? Math.floor(Math.min(...objects.map((o) => o.y)) / grid);
  const width = Math.max(
    rect?.w ?? 1,
    ...objects.map((o) => Math.ceil((o.x + (o.kind === 'rectangle' ? o.width : 1)) / grid) - x),
  );
  const height = Math.max(
    rect?.h ?? 1,
    ...objects.map((o) => Math.ceil((o.y + (o.kind === 'rectangle' ? o.height : 1)) / grid) - y),
  );
  const ids = new Set(objects.map((o) => o.id));
  const copied: SceneLayer[] = layers.flatMap((l): SceneLayer[] => {
    if (l.type === 'tilelayer') {
      return rect
        ? [
            {
              ...l,
              cells: Array.from({ length: height }, (_, dy) =>
                Array.from({ length: width }, (_, dx) => l.cells[y + dy][x + dx]),
              ),
            },
          ]
        : [];
    }
    const items = l.objects.filter((o) => ids.has(o.id));
    return items.length
      ? [
          {
            ...l,
            objects: items.map((o) => ({
              ...structuredClone(o),
              x: o.x - x * grid,
              y: o.y - y * grid,
            })),
          },
        ]
      : [];
  });
  if (!copied.length) {
    throw Error('The selection is empty.');
  }
  return {
    composition: {
      project,
      slots: copied.map((l) =>
        editor.layers
          .filter((other) => other.type === l.type && other.name === l.name)
          .findIndex((other) => other.id === l.id),
      ),
      scene: {
        width,
        height,
        grid,
        layers: copied,
        next_layer_id: editor.scene.next_layer_id,
        next_object_id: editor.scene.next_object_id,
      },
    },
    x,
    y,
    ids,
  };
}
export function eraseCaptured(editor: LayerEditor, selection: CompositionSelection) {
  const captured = capture(editor, selection, '');
  const rect = selection.rectangle;
  editor.change(() => {
    for (const layer of selectedLayers(editor, selection)) {
      if (layer.type === 'tilelayer' && rect) {
        for (let y = rect.y; y < rect.y + captured.composition.scene.height; y++) {
          for (let x = rect.x; x < rect.x + captured.composition.scene.width; x++) {
            layer.cells[y][x] = editor.floor;
          }
        }
      } else if (layer.type === 'objectgroup') {
        layer.objects = layer.objects.filter((o) => !captured.ids.has(o.id));
      }
    }
  });
}
export function paste(
  editor: LayerEditor,
  value: Composition,
  project: string,
  x: number,
  y: number,
  validTile: (asset: string) => boolean,
  allocate = true,
) {
  if (value.project !== project) {
    throw Error('Clipboard belongs to another project.');
  }
  const source = value.scene;
  if (source.grid !== editor.scene.grid) {
    throw Error('Paste needs the same grid size.');
  }
  if (
    ![x, y].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    x + source.width > editor.scene.width ||
    y + source.height > editor.scene.height
  ) {
    throw Error('The entire composition must fit inside the scene.');
  }
  let next = editor.scene.next_object_id;
  const placements = source.layers.map((layer, i) => {
    const index = value.slots[i];
    const matches = editor.layers.filter((l) => l.name === layer.name && l.type === layer.type);
    const target = matches[index];
    if (!target || !target.visible) {
      throw Error(`Show or create matching layer: ${layer.name} (${layer.type}, ${index + 1}).`);
    }
    if (layer.type === 'tilelayer') {
      for (const row of layer.cells) {
        for (const cell of row) {
          if (cell !== editor.floor && cell !== '' && !validTile(tileParts(cell)[0])) {
            throw Error(`Missing tile asset: ${cell}.`);
          }
        }
      }
      return { target, layer };
    }
    if (target.type !== 'objectgroup' || target.objects.length + layer.objects.length > 4096) {
      throw Error('Use at most 4096 objects per layer.');
    }
    const objects = layer.objects.map((o) => ({
      ...structuredClone(o),
      id: allocate ? String(next++) : o.id,
      x: o.x + x * source.grid,
      y: o.y + y * source.grid,
    }));
    objects.forEach((o) => {
      editor.validateObject(o);
      if (
        editor.layers.some(
          (l) => l.type === 'objectgroup' && l.objects.some((existing) => existing.id === o.id),
        )
      ) {
        throw Error('Object ID conflict.');
      }
    });
    return { target, layer: { ...layer, objects } };
  });
  const ids = new Set<string>();
  editor.change(() => {
    for (const { target, layer } of placements) {
      if (target.type === 'tilelayer' && layer.type === 'tilelayer') {
        layer.cells.forEach((row, dy) =>
          row.forEach((cell, dx) => {
            target.cells[y + dy][x + dx] = cell || editor.floor;
          }),
        );
      }
      if (target.type === 'objectgroup' && layer.type === 'objectgroup') {
        target.objects.push(...layer.objects);
        layer.objects.forEach((o) => ids.add(o.id));
      }
    }
    editor.scene.next_object_id = next;
  });
  return ids;
}
export function transform(
  value: Composition,
  operation: 'horizontal' | 'vertical' | 'rotate',
): Composition {
  const result = structuredClone(value),
    scene = result.scene;
  if (
    scene.layers.some((l) => l.type === 'objectgroup' && l.objects.some((o) => o.kind === 'sprite'))
  ) {
    throw Error('Sprite transforms are unsupported. Select tiles, points or rectangles.');
  }
  const width = scene.width * scene.grid,
    height = scene.height * scene.grid;
  for (const layer of scene.layers) {
    if (layer.type === 'tilelayer') {
      const cells = layer.cells;
      layer.cells = Array.from(
        { length: operation === 'rotate' ? scene.width : scene.height },
        (_, y) =>
          Array.from({ length: operation === 'rotate' ? scene.height : scene.width }, (_, x) =>
            transformCell(
              operation === 'rotate'
                ? cells[scene.height - 1 - x][y]
                : operation === 'horizontal'
                  ? cells[y][scene.width - 1 - x]
                  : cells[scene.height - 1 - y][x],
              operation,
            ),
          ),
      );
    } else {
      for (const o of layer.objects) {
        const w = o.kind === 'rectangle' ? o.width : 1,
          h = o.kind === 'rectangle' ? o.height : 1;
        if (operation === 'horizontal') {
          o.x = width - o.x - w;
        } else if (operation === 'vertical') {
          o.y = height - o.y - h;
        } else {
          const x = o.x;
          o.x = height - o.y - h;
          o.y = x;
          if (o.kind === 'rectangle') {
            o.width = h;
            o.height = w;
          }
        }
      }
    }
  }
  if (operation === 'rotate') {
    [scene.width, scene.height] = [scene.height, scene.width];
  }
  return result;
}
