/** Transient view categories; authored visibility and native scene data stay authoritative. */
import type { SceneObject } from '../objects/objects.mts';
import type { ObjectDefinition } from '../objects/object-definitions.mts';
import { resolveDefinition } from '../objects/object-definitions.mts';

export const viewCategories = ['tiles', 'sprites', 'geometry', 'gameplay', 'guides'] as const;
export type ViewCategory = (typeof viewCategories)[number];
export type ViewFilters = Record<ViewCategory, boolean>;
export function allViewFilters(): ViewFilters {
  return { tiles: true, sprites: true, geometry: true, gameplay: true, guides: true };
}
export function objectViewCategory(
  item: SceneObject,
  definitions: ObjectDefinition[],
): ViewCategory {
  // Artwork always remains artwork, even when it carries gameplay metadata.
  if (item.kind === 'sprite') {
    return 'sprites';
  }
  const properties = Object.fromEntries(
    resolveDefinition(item, definitions).properties.map((p) => [p.name, p.value]),
  );
  const category = properties.forge_view;
  if (category === 'geometry' || category === 'gameplay' || category === 'guides') {
    return category;
  }
  const role = properties.blockout_role;
  if (role === 'camera' || role === 'note' || role === 'section') {
    return 'guides';
  }
  if (role === 'patrol' || role === 'approach' || role === 'arena' || role === 'detour') {
    return 'gameplay';
  }
  return item.kind === 'rectangle' ? 'geometry' : 'gameplay';
}
