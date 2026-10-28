/** Pure resize preflight shared by the preview and the undoable scene edit. */
import type { LayerEditor } from './layers.mts';
import { clone } from './model.mts';

export function resizeScene(editor: LayerEditor, width: number, height: number, anchor: string) {
  if (![width, height].every((n) => Number.isInteger(n) && n >= 1 && n <= 256)) {
    throw Error('Scene dimensions must be within 1..256.');
  }
  if (!/^[012],[012]$/.test(anchor)) {
    throw Error('Choose a resize anchor.');
  }
  const [ax, ay] = anchor.split(',').map(Number);
  const scene = clone(editor.scene);
  // Center offsets round down to whole cells, including negative crop offsets.
  const dx = Math.floor(((width - scene.width) * ax) / 2);
  const dy = Math.floor(((height - scene.height) * ay) / 2);
  let tiles = 0,
    removed = 0,
    clipped = 0;
  const objects: string[] = [];
  for (const layer of scene.layers) {
    if (layer.type === 'tilelayer') {
      const cells = Array.from({ length: height }, () => Array<string>(width).fill(editor.floor));
      layer.cells.forEach((row, y) =>
        row.forEach((cell, x) => {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
            cells[ny][nx] = cell;
          } else if (cell !== editor.floor) {
            tiles++;
          }
        }),
      );
      layer.cells = cells;
    } else {
      layer.objects = layer.objects.filter((item) => {
        item.x += dx * scene.grid;
        item.y += dy * scene.grid;
        const label = `${layer.name}: ${item.name || item.id}`;
        if (item.kind === 'rectangle') {
          const right = Math.min(width * scene.grid, item.x + item.width);
          const bottom = Math.min(height * scene.grid, item.y + item.height);
          const x = Math.max(0, item.x),
            y = Math.max(0, item.y);
          if (right > x && bottom > y) {
            if (
              x !== item.x ||
              y !== item.y ||
              right - x !== item.width ||
              bottom - y !== item.height
            ) {
              clipped++;
              objects.push(`Clip rectangle — ${label}`);
            }
            Object.assign(item, { x, y, width: right - x, height: bottom - y });
            return true;
          }
        } else if (
          item.x >= 0 &&
          item.y >= 0 &&
          item.x < width * scene.grid &&
          item.y < height * scene.grid
        ) {
          // Sprite anchors determine membership; native artwork may extend past the edge.
          return true;
        }
        removed++;
        objects.push(`Remove object — ${label}`);
        return false;
      });
    }
  }
  scene.width = width;
  scene.height = height;
  return { scene, dx, dy, tiles, removed, clipped, objects };
}
