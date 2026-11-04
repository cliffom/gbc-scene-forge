/** RGBA document budgets mirrored by artwork.dimensions and boundary fixtures. */
/** Tiles and animation sheets use eight-pixel geometry, unlike static sprites. */
export const GRID_UNIT = 8;
export const MAX_GRID_AXIS = 256;
export const TILE_SIZES = [8, 16, 32] as const;
/** UTF-8 two-space JSON with a final newline, matching core.serialization.record_bytes. */
export const MAX_DESCRIPTOR_BYTES = 64 * 1024;
/** Composite plus every layer share the document pixel budget. */
export const MAX_LAYERS = 8;
/** Explicit rectangles let larger documents synchronize in bounded pixel patches. */
export const MAX_PIXEL_PATCH_PIXELS = 65_536;
export const MAX_ARTWORK_AXIS = 4096;
export const MAX_ARTWORK_PIXELS = 4_194_304;
export const MAX_RGBA_BASE64 = 4 * Math.ceil((MAX_ARTWORK_PIXELS * 4) / 3);
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
