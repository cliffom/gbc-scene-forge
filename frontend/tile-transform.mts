import type { TileMetadata } from './tile-metadata.mts';
/** Tiled orthogonal flags: diagonal (swap axes), then horizontal/vertical. */
export function tileParts(cell: string): [string, number] {
  const match = /#([1-7])$/.exec(cell);
  return match ? [cell.slice(0, -2), Number(match[1])] : [cell, 0];
}
export function tilePoint(flags: number, x: number, y: number, size = 1): [number, number] {
  if (flags & 4) {
    [x, y] = [y, x];
  }
  return [flags & 1 ? size - x : x, flags & 2 ? size - y : y];
}
export function transformCell(cell: string, operation: 'horizontal' | 'vertical' | 'rotate') {
  if (!cell || cell === 'empty') {
    return cell;
  }
  const [asset, flags] = tileParts(cell);
  const next = operation === 'horizontal' ? 1 : operation === 'vertical' ? 2 : 5;
  const points = [
    [0, 0],
    [1, 0],
    [0, 1],
  ].map(([x, y]) => tilePoint(next, ...tilePoint(flags, x, y)));
  const result = Array.from({ length: 8 }, (_, i) => i).find((i) =>
    [
      [0, 0],
      [1, 0],
      [0, 1],
    ].every(([x, y], j) => tilePoint(i, x, y).every((v, k) => v === points[j][k])),
  );
  return asset + (result ? `#${result}` : '');
}
export function tileContext(context: CanvasRenderingContext2D, flags: number, size: number) {
  const [x, y] = tilePoint(flags, 0, 0, size);
  const a = tilePoint(flags, size, 0, size),
    b = tilePoint(flags, 0, size, size);
  context.transform(
    (a[0] - x) / size,
    (a[1] - y) / size,
    (b[0] - x) / size,
    (b[1] - y) / size,
    x,
    y,
  );
}

export function transformMetadata(value: TileMetadata, flags: number, size: number): TileMetadata {
  return {
    ...value,
    shapes: value.shapes.map((shape) => {
      if (shape.kind === 'polygon') {
        return { ...shape, points: shape.points.map(([x, y]) => tilePoint(flags, x, y, size)) };
      }
      const a = tilePoint(flags, shape.x, shape.y, size),
        b = tilePoint(flags, shape.x + shape.width, shape.y + shape.height, size);
      return {
        ...shape,
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        width: Math.abs(a[0] - b[0]),
        height: Math.abs(a[1] - b[1]),
      };
    }),
  };
}
