/** RGBA document budgets mirrored by artwork.dimensions and boundary fixtures. */
export const MAX_ARTWORK_AXIS = 4096;
export const MAX_ARTWORK_PIXELS = 4_194_304;
export const MAX_RGBA_BASE64 = 4 * Math.ceil((MAX_ARTWORK_PIXELS * 4) / 3);
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
