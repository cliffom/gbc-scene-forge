/** Native scene budgets; mirrored in scenes/dimensions.py. */
import { TILE_SIZES as SCENE_GRIDS } from '../artwork/artwork-limits.mts';
export { SCENE_GRIDS };
export const MAX_SCENE_CELLS = 65_536;
export const MAX_SCENE_PIXELS = 8192;
export const MAX_SCENE_LAYERS = 128;
export const MAX_OBJECTS_PER_LAYER = 4096;

export function checkDimensions(width: number, height: number, grid: number) {
  if (!SCENE_GRIDS.some((size) => size === grid)) {
    throw Error('Choose an 8, 16 or 32 pixel grid.');
  }
  if (
    ![width, height].every((n) => Number.isInteger(n) && n >= 1 && n * grid <= MAX_SCENE_PIXELS)
  ) {
    throw Error('Scene dimensions must be positive whole cells and at most 8192 pixels per axis.');
  }
  if (width * height > MAX_SCENE_CELLS) {
    throw Error('Scene area must be at most 65536 cells.');
  }
}

export function validDimensions(width: number, height: number, grid: number) {
  try {
    checkDimensions(width, height, grid);
    return true;
  } catch {
    return false;
  }
}
