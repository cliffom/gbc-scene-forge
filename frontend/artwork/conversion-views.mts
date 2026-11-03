/** Bounded scene views covering every selected sprite, including its origin. */
import { objectBounds, type SceneObject } from '../objects/objects.mts';
import type { Atlas } from '../project/project-contracts.mts';

type Rectangle = { x: number; y: number; width: number; height: number };

export function conversionViews(
  objects: SceneObject[],
  atlases: Record<string, Atlas>,
  sceneWidth: number,
  sceneHeight: number,
): Rectangle[] {
  if (!objects.length) {
    throw Error('Select sprite objects to review.');
  }
  const bounds = objects.map((item) => {
    if (item.kind !== 'sprite') {
      throw Error('Only sprite placements can become tiles.');
    }
    const [atlas, region] = item.asset.split('/');
    return objectBounds(
      item,
      atlases[atlas]?.regions.find((r) => r.name === region),
    );
  });
  const width = Math.min(256, sceneWidth),
    height = Math.min(256, sceneHeight);
  function centered(r: Rectangle): Rectangle {
    return {
      x: Math.max(0, Math.min(sceneWidth - width, Math.floor(r.x + (r.width - width) / 2))),
      y: Math.max(0, Math.min(sceneHeight - height, Math.floor(r.y + (r.height - height) / 2))),
      width,
      height,
    };
  }
  const left = Math.min(...bounds.map((r) => r.x)),
    top = Math.min(...bounds.map((r) => r.y));
  const all = {
    x: left,
    y: top,
    width: Math.max(...bounds.map((r) => r.x + r.width)) - left,
    height: Math.max(...bounds.map((r) => r.y + r.height)) - top,
  };
  if (all.width <= width && all.height <= height) {
    return [centered(all)];
  }
  const views: Rectangle[] = [];
  for (const r of bounds) {
    // Imported sprites may exceed one view. Split their bounds without gaps.
    for (let y = r.y; y < r.y + r.height; y += height) {
      for (let x = r.x; x < r.x + r.width; x += width) {
        const part = {
          x,
          y,
          width: Math.min(width, r.x + r.width - x),
          height: Math.min(height, r.y + r.height - y),
        };
        if (
          !views.some(
            (v) =>
              part.x >= v.x &&
              part.y >= v.y &&
              part.x + part.width <= v.x + v.width &&
              part.y + part.height <= v.y + v.height,
          )
        ) {
          views.push(centered(part));
        }
      }
    }
  }
  return views;
}
