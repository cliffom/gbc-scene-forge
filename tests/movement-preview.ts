import assert from 'node:assert/strict';
import type { CollisionShape } from '../frontend/artwork/tile-metadata.mts';
import type { SceneLayer } from '../frontend/scene/layers.mts';
import { test } from 'node:test';
import {
  MovementPreview,
  metadataOverlaps,
  parsePreviewPath,
  shapeOverlaps,
  sceneOverlaps,
} from '../frontend/preview/movement-preview.mts';
import { emptyMetadata } from '../frontend/artwork/tile-metadata.mts';

const world = { width: 200, height: 200, blocked: () => false };
const idle = { x: 0, y: 0 };
await test('keyboard speed is independent of direction, with bounded time after suspension', () => {
  const movement = new MovementPreview();
  const saved = { x: 40, y: 40 };
  movement.reset(saved);
  movement.advance(100, { x: 1, y: 1 }, world);
  assert(Math.abs(Math.hypot(movement.position.x - 40, movement.position.y - 40) - 4.8) < 1e-8);
  assert.equal(movement.moving, true);
  movement.advance(0, idle, world);
  assert.equal(movement.moving, false);
  movement.reset(saved);
  movement.advance(100000, { x: 1, y: 0 }, world);
  assert(Math.abs(movement.position.x - 44.8) < 1e-8);
  assert.deepEqual(saved, { x: 40, y: 40 });
});
await test('waypoints follow segments in order and keyboard movement takes control', () => {
  const movement = new MovementPreview();
  movement.reset({ x: 10, y: 10 });
  movement.speed = 100;
  movement.path = parsePreviewPath('12, 10\n12, 14');
  movement.advance(100, idle, world);
  assert.deepEqual(movement.position, { x: 12, y: 14 });
  assert.equal(movement.path.length, 0);
  assert.equal(movement.direction, 'down');
  movement.path = [{ x: 12, y: 30 }];
  movement.advance(10, { x: -1, y: 0 }, world);
  assert.equal(movement.path.length, 0);
  assert.equal(movement.direction, 'left');
  movement.reset({ x: 10, y: 10 });
  assert.equal(movement.moving, false);
});
await test('collision uses a separate footprint, can be disabled, and stops a path without tunneling', () => {
  const movement = new MovementPreview();
  movement.footprint = { x: -1, y: -1, width: 2, height: 2 };
  movement.speed = 512;
  movement.reset({ x: 10, y: 10 });
  const barrier = {
    ...world,
    blocked: (rect: { x: number; width: number }) => rect.x < 20.01 && rect.x + rect.width > 20,
  };
  movement.path = [{ x: 50, y: 10 }];
  movement.checkCollisions = true;
  movement.advance(100, idle, barrier);
  assert.equal(movement.position.x, 19);
  assert.equal(movement.blocked, true);
  assert.equal(movement.path.length, 0);
  movement.advance(16, idle, barrier);
  assert.equal(movement.blocked, true);
  movement.checkCollisions = false;
  movement.advance(100, { x: 1, y: 0 }, barrier);
  assert(movement.position.x > 50);
});
await test('scene bounds constrain the footprint even with collision checks disabled', () => {
  const movement = new MovementPreview();
  movement.reset({ x: 5, y: 10 });
  movement.advance(100, { x: -1, y: 0 }, world);
  assert.equal(movement.position.x, 4);
  assert.equal(movement.blocked, true);
  movement.reset({ x: 196, y: 196 });
  movement.advance(100, { x: 1, y: 1 }, world);
  assert.deepEqual(movement.position, { x: 196, y: 196 });
});
await test('rectangle and ellipse collisions allow contact but reject positive overlap', () => {
  const rectangle = { id: 1, kind: 'rectangle' as const, x: 0, y: 0, width: 8, height: 8 };
  assert.equal(shapeOverlaps({ x: 8, y: 0, width: 2, height: 2 }, rectangle), false);
  assert.equal(shapeOverlaps({ x: 7, y: 0, width: 2, height: 2 }, rectangle), true);
  const ellipse = { ...rectangle, kind: 'ellipse' as const };
  assert.equal(shapeOverlaps({ x: 0, y: 0, width: 1, height: 1 }, ellipse), false);
  assert.equal(shapeOverlaps({ x: 3, y: 3, width: 2, height: 2 }, ellipse), true);
  assert.equal(shapeOverlaps({ x: 8, y: 3, width: 2, height: 2 }, ellipse), false);
});
await test('polygon collision handles sloped edges, enclosure and concave cutouts', () => {
  const triangle: CollisionShape = {
    id: 1,
    kind: 'polygon' as const,
    points: [
      [0, 0],
      [8, 0],
      [0, 8],
    ],
  };
  assert.equal(shapeOverlaps({ x: 5, y: 5, width: 1, height: 1 }, triangle), false);
  assert.equal(shapeOverlaps({ x: 2, y: 2, width: 1, height: 1 }, triangle), true);
  assert.equal(shapeOverlaps({ x: -1, y: -1, width: 10, height: 10 }, triangle), true);
  assert.equal(shapeOverlaps({ x: 4, y: 4, width: 1, height: 1 }, triangle), false);
  const concave: CollisionShape = {
    ...triangle,
    points: [
      [0, 0],
      [8, 0],
      [8, 2],
      [2, 2],
      [2, 8],
      [0, 8],
    ],
  };
  assert.equal(shapeOverlaps({ x: 4, y: 4, width: 2, height: 2 }, concave), false);
  assert.equal(shapeOverlaps({ x: 1, y: 4, width: 2, height: 2 }, concave), true);
});
await test('placed collision metadata respects local offsets and shape overrides', () => {
  const rect = { x: 100, y: 100, width: 8, height: 8 };
  const footprint = { x: 101, y: 101, width: 2, height: 2 };
  assert.equal(metadataOverlaps(footprint, undefined, rect), false);
  const metadata = { ...emptyMetadata(), solid: true };
  assert.equal(metadataOverlaps(footprint, metadata, rect), true);
  metadata.shapes = [{ id: 1, kind: 'rectangle', x: 6, y: 6, width: 2, height: 2 }];
  assert.equal(metadataOverlaps(footprint, metadata, rect), false);
  assert.equal(metadataOverlaps({ ...footprint, x: 106, y: 106 }, metadata, rect), true);
});
await test('path input rejects missing, excessive and non-finite coordinates', () => {
  for (const text of [
    '',
    '1',
    ',2',
    '1,2,3',
    'Infinity,0',
    'a,2',
    Array(129).fill('1,2').join('\n'),
  ]) {
    assert.throws(() => parsePreviewPath(text));
  }
  assert.deepEqual(parsePreviewPath(' 1.5, 2 \n\n3,4'), [
    { x: 1.5, y: 2 },
    { x: 3, y: 4 },
  ]);
});

await test('scene collision excludes the preview actor, hidden layers, markers and triggers', () => {
  const rect = { x: 8, y: 0, width: 2, height: 2 };
  const layers: SceneLayer[] = [
    { id: 1, name: 'Ground', type: 'tilelayer', visible: true, cells: [['empty', 'wall']] },
  ];
  const metadata = (group: string, asset: string) =>
    asset === 'empty' ? undefined : { ...emptyMetadata(), solid: true };
  const bounds = () => rect;
  assert.equal(sceneOverlaps(rect, layers, 8, '1', metadata, bounds), true);
  layers[0].visible = false;
  assert.equal(sceneOverlaps(rect, layers, 8, '1', metadata, bounds), false);
  layers.push({
    id: 2,
    name: 'Objects',
    type: 'objectgroup',
    visible: true,
    objects: [
      {
        id: '1',
        kind: 'sprite',
        asset: 'actors/idle',
        name: '',
        class: '',
        x: 8,
        y: 0,
        properties: [],
      },
      { id: '2', kind: 'point', name: '', class: '', x: 8, y: 0, properties: [] },
      {
        id: '3',
        kind: 'rectangle',
        name: '',
        class: '',
        x: 8,
        y: 0,
        width: 8,
        height: 8,
        properties: [],
      },
    ],
  });
  assert.equal(sceneOverlaps(rect, layers, 8, '1', metadata, bounds), false);
  assert.equal(sceneOverlaps(rect, layers, 8, 'other', metadata, bounds), true);
  layers[1].visible = false;
  assert.equal(sceneOverlaps(rect, layers, 8, 'other', metadata, bounds), false);
});

await test('pause holds position and waypoints; reset clears pause and restores initial facing', () => {
  const movement = new MovementPreview();
  movement.initialDirection = 'left';
  movement.reset({ x: 20, y: 20 });
  movement.path = [{ x: 80, y: 20 }];
  movement.advance(100, idle, world);
  const position = { ...movement.position };
  movement.paused = true;
  movement.advance(1000, { x: 0, y: 1 }, world);
  assert.deepEqual(movement.position, position);
  assert.equal(movement.path.length, 1);
  movement.paused = false;
  movement.advance(100, idle, world);
  assert(movement.position.x > position.x);
  movement.paused = true;
  movement.reset({ x: 20, y: 20 });
  assert.equal(movement.paused, false);
  assert.equal(movement.direction, 'left');
  assert.deepEqual(movement.position, { x: 20, y: 20 });
});
