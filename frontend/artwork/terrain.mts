/** Four-neighbor terrain rules. Occupancy is the authored tile classification. */
import type { LayerEditor } from '../scene/layers.mts';
import type { Project } from '../project/project-contracts.mts';
import type { TileMetadata } from './tile-metadata.mts';
import { emptyMetadata } from './tile-metadata.mts';
import { tileParts, transformMetadata } from './tile-transform.mts';

export const neighbors = [
  [0, -1, 1],
  [1, 0, 2],
  [0, 1, 4],
  [-1, 0, 8],
] as const;
export interface TerrainRules {
  metadata: Map<string, TileMetadata>;
  families: Map<string, Map<number, string[]>>;
}
export function terrainRules(project: Pick<Project, 'atlases'> | null, grid: number): TerrainRules {
  const metadata = new Map<string, TileMetadata>();
  const families = new Map<string, Map<number, string[]>>();
  for (const atlas of Object.values(project?.atlases ?? {})) {
    for (const [asset, value] of Object.entries(atlas.metadata[String(grid)] ?? {})) {
      if (atlas.mappings[String(grid)]?.[asset] === undefined) {
        continue;
      }
      metadata.set(asset, value);
      if (value.terrain_mask === undefined) {
        continue;
      }
      let masks = families.get(value.terrain);
      if (!masks) {
        masks = new Map();
        families.set(value.terrain, masks);
      }
      const choices = masks.get(value.terrain_mask) ?? [];
      choices.push(asset);
      choices.sort();
      masks.set(value.terrain_mask, choices);
    }
  }
  return { metadata, families };
}
function collision(value: TileMetadata) {
  // IDs do not affect geometry; explicit full-tile shapes remain conservatively distinct.
  return JSON.stringify([
    value.solid,
    value.shapes.map((shape) => {
      return Object.fromEntries(Object.entries(shape).filter(([key]) => key !== 'id'));
    }),
  ]);
}
export function ruleReport(rules: TerrainRules, terrain: string) {
  const masks = rules.families.get(terrain);
  if (!masks) {
    return ['No transition rules.'];
  }
  const missing = Array.from({ length: 16 }, (_, i) => i).filter((i) => !masks.has(i));
  const duplicates = [...masks].filter(([, assets]) => assets.length > 1).map(([mask]) => mask);
  const result: string[] = [];
  if (missing.length) {
    result.push(`Missing masks: ${missing.join(', ')}. Unmatched cells keep their tile.`);
  }
  if (duplicates.length) {
    result.push(`Duplicate masks: ${duplicates.join(', ')}. First asset by ID wins.`);
  }
  const signatures = new Set(
    [...masks.values()]
      .flat()
      .map((asset) => collision(rules.metadata.get(asset) ?? emptyMetadata())),
  );
  if (signatures.size > 1) {
    result.push(
      'Variants have different collision metadata. Make collision consistent before painting.',
    );
  }
  return result;
}
/** Stage all replacements before authoring; one stroke owns the cell and its neighbors. */
export function paintTerrain(
  editor: LayerEditor,
  rules: TerrainRules,
  terrain: string,
  x: number,
  y: number,
  erase = false,
): string[] {
  editor.check(x, y);
  const masks = rules.families.get(terrain);
  if (!masks?.size) {
    throw Error('Choose a configured terrain brush.');
  }
  const representatives = [...masks.values()].flat().sort();
  const signature = collision(rules.metadata.get(representatives[0]) ?? emptyMetadata());
  if (
    representatives.some(
      (asset) => collision(rules.metadata.get(asset) ?? emptyMetadata()) !== signature,
    )
  ) {
    throw Error(
      'Terrain variants have different collision metadata. Make their collision consistent before painting.',
    );
  }
  const cells = editor.cells;
  const inBounds = (px: number, py: number) =>
    px >= 0 && py >= 0 && px < editor.scene.width && py < editor.scene.height;
  const existing = cells[y][x];
  const seed = erase
    ? editor.floor
    : rules.metadata.get(tileParts(existing)[0])?.terrain === terrain
      ? existing
      : representatives[0];
  const at = (px: number, py: number) => (px === x && py === y ? seed : cells[py][px]);
  const classification = (cell: string) => rules.metadata.get(tileParts(cell)[0])?.terrain;
  const changes = new Map<string, { x: number; y: number; asset: string }>();
  changes.set(`${x},${y}`, { x, y, asset: seed });
  const warnings = new Set<string>();
  for (const [px, py] of [[x, y], ...neighbors.map(([dx, dy]) => [x + dx, y + dy])]) {
    if (!inBounds(px, py)) {
      continue;
    }
    const current = at(px, py),
      name = classification(current);
    if (!name || (erase && px === x && py === y)) {
      continue;
    }
    const family = rules.families.get(name);
    if (!family) {
      continue;
    }
    const mask = neighbors.reduce(
      (mask, [dx, dy, bit]) =>
        mask |
        (inBounds(px + dx, py + dy) && classification(at(px + dx, py + dy)) === name ? bit : 0),
      0,
    );
    const choices = family.get(mask);
    if (!choices?.length) {
      warnings.add(`Missing ${name} mask ${mask}; kept its tile.`);
      continue;
    }
    if (choices.length > 1) {
      warnings.add(`Duplicate ${name} mask ${mask}; chose ${choices[0]}.`);
    }
    const [base, flags] = tileParts(current);
    const metadata = rules.metadata.get(base) ?? emptyMetadata();
    if (
      collision(transformMetadata(metadata, flags, editor.scene.grid)) !==
      collision(rules.metadata.get(choices[0]) ?? emptyMetadata())
    ) {
      warnings.add(`Kept ${name} neighbor to preserve its collision.`);
      continue;
    }
    changes.set(`${px},${py}`, { x: px, y: py, asset: choices[0] });
  }
  for (const change of changes.values()) {
    editor.check(change.x, change.y);
  }
  editor.change(() => {
    for (const change of changes.values()) {
      cells[change.y][change.x] = change.asset;
    }
  });
  return [...warnings];
}
