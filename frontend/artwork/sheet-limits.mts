/** Counts bound descriptor size and animation review work; mirrors artwork.sheets. */
export const MAX_FRAMES = 128;
export const MAX_SEQUENCES = 64;
export const MAX_SEQUENCE_FRAMES = 256;
export const MAX_TOTAL_SEQUENCE_FRAMES = 1024;
/** APNG stores millisecond numerators as uint16; zero is not an authoring duration. */
export const MIN_DURATION_MS = 1;
export const MAX_DURATION_MS = 65_535;
