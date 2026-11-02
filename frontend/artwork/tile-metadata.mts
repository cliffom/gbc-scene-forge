/** Authored tile metadata uses native tile-local pixels, independent of atlas artwork. */
import * as v from 'valibot';
import {
  bool,
  finite,
  jsonArray,
  jsonDictionary,
  jsonObject,
  parse,
  text,
} from '../shared/schema.mts';

const pointSchema = v.pipe(
  jsonArray(finite),
  v.length(2, 'Expected a collision point.'),
  v.transform((point): [number, number] => [point[0], point[1]]),
);
const shapeSchema = v.pipe(
  jsonObject({
    id: finite,
    kind: v.unknown(),
    points: v.unknown(),
    x: v.unknown(),
    y: v.unknown(),
    width: v.unknown(),
    height: v.unknown(),
  }),
  v.transform(({ id, kind, points, x, y, width, height }) => {
    if (kind === 'polygon') {
      return { id, kind: 'polygon' as const, points: parse(jsonArray(pointSchema), points) };
    }
    if (kind !== 'rectangle' && kind !== 'ellipse') {
      throw Error('Unsupported collision shape.');
    }
    return {
      id,
      kind: kind === 'rectangle' ? ('rectangle' as const) : ('ellipse' as const),
      ...parse(jsonObject({ x: finite, y: finite, width: finite, height: finite }), {
        x,
        y,
        width,
        height,
      }),
    };
  }),
);
export type CollisionShape = v.InferOutput<typeof shapeSchema>;
export const metadataSchema = v.pipe(
  jsonObject({
    terrain: text,
    terrain_mask: v.optional(finite),
    solid: bool,
    next_shape_id: finite,
    shapes: jsonArray(shapeSchema),
  }),
  v.transform(({ terrain_mask, ...data }) => ({
    ...data,
    ...(terrain_mask === undefined ? {} : { terrain_mask }),
  })),
);
export type TileMetadata = v.InferOutput<typeof metadataSchema>;
export const emptyMetadata = (): TileMetadata => ({
  terrain: '',
  solid: false,
  shapes: [],
  next_shape_id: 1,
});
export const metadataSetsSchema = v.nullish(jsonDictionary(jsonDictionary(metadataSchema)), {});
export type MetadataSets = v.InferOutput<typeof metadataSetsSchema>;
export function decodeMetadata(value: unknown): TileMetadata {
  return parse(metadataSchema, value);
}
export function decodeMetadataSets(value: unknown): MetadataSets {
  return parse(metadataSetsSchema, value);
}
const integer = (value: number, low: number, high: number) =>
  Number.isInteger(value) && value >= low && value <= high;
type Vertex = [number, number];
const cross = (a: Vertex, b: Vertex, c: Vertex) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function intersects(a: Vertex, b: Vertex, c: Vertex, d: Vertex) {
  const on = (a: Vertex, b: Vertex, c: Vertex) =>
    cross(a, b, c) === 0 &&
    c.every((v, i) => v >= Math.min(a[i], b[i]) && v <= Math.max(a[i], b[i]));
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
}
export function validateMetadata(value: TileMetadata, width: number, height: number) {
  if (value.terrain.length > 100) {
    throw Error('Terrain classification must contain at most 100 characters.');
  }
  if (
    value.terrain_mask !== undefined &&
    (!value.terrain.trim() || !integer(value.terrain_mask, 0, 15))
  ) {
    throw Error('Terrain transitions need a classification and a mask from 0 to 15.');
  }
  if (value.shapes.length > 32) {
    throw Error('Use at most 32 collision shapes per tile.');
  }
  const ids = new Set<number>();
  for (const shape of value.shapes) {
    if (!integer(shape.id, 1, 2147483646) || ids.has(shape.id)) {
      throw Error('Invalid or duplicate collision shape ID.');
    }
    ids.add(shape.id);
    if (shape.kind !== 'polygon') {
      if (
        !integer(shape.x, 0, width - 1) ||
        !integer(shape.y, 0, height - 1) ||
        !integer(shape.width, 1, width - shape.x) ||
        !integer(shape.height, 1, height - shape.y)
      ) {
        throw Error('Collision shapes need positive whole-pixel bounds inside the tile.');
      }
    } else {
      const points = shape.points;
      if (
        points.length < 3 ||
        points.length > 32 ||
        points.some(([x, y]) => !integer(x, 0, width) || !integer(y, 0, height))
      ) {
        throw Error('Polygons need 3..32 whole-pixel points inside the tile (including edges).');
      }
      if (new Set(points.map((p) => p.join(','))).size !== points.length) {
        throw Error('Polygon points must be unique.');
      }
      const edges = points.map((p, i) => [p, points[(i + 1) % points.length]] as const);
      if (edges.reduce((area, [a, b]) => area + a[0] * b[1] - b[0] * a[1], 0) === 0) {
        throw Error('Collision polygon needs nonzero area.');
      }
      if (
        points.some(
          (p, i) =>
            cross(
              points[(i + points.length - 1) % points.length],
              p,
              points[(i + 1) % points.length],
            ) === 0,
        )
      ) {
        throw Error('Remove collinear polygon vertices.');
      }
      if (
        edges.some(([a, b], i) =>
          edges.some(
            ([c, d], j) =>
              j > i + 1 && !(i === 0 && j === edges.length - 1) && intersects(a, b, c, d),
          ),
        )
      ) {
        throw Error('Collision polygon must not intersect itself.');
      }
    }
  }
  if (!integer(value.next_shape_id, Math.max(0, ...ids) + 1, 2147483647)) {
    throw Error('Invalid next collision shape ID.');
  }
}
export function terrainColor(terrain: string) {
  let hash = 0;
  for (const char of terrain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `hsl(${hash % 360} 65% 60% / 35%)`;
}
export function drawCollision(
  ctx: CanvasRenderingContext2D,
  value: TileMetadata,
  width: number,
  height: number,
) {
  const shapes: CollisionShape[] = value.shapes.length
    ? value.shapes
    : value.solid
      ? [{ id: 1, kind: 'rectangle', x: 0, y: 0, width, height }]
      : [];
  ctx.save();
  ctx.fillStyle = '#ed886f55';
  ctx.strokeStyle = '#ed886f';
  ctx.lineWidth = 0.75;
  for (const shape of shapes) {
    ctx.beginPath();
    if (shape.kind === 'polygon') {
      shape.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    } else if (shape.kind === 'ellipse') {
      ctx.ellipse(
        shape.x + shape.width / 2,
        shape.y + shape.height / 2,
        shape.width / 2,
        shape.height / 2,
        0,
        0,
        Math.PI * 2,
      );
    } else {
      ctx.rect(shape.x, shape.y, shape.width, shape.height);
    }
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
