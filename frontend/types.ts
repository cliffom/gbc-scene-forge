/** Generic editor geometry and model contracts, independent of transports. */
export interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
  tx: number;
  ty: number;
}
export interface Constraint {
  x: number;
  y: number;
  reason: string;
}
export interface Marker {
  x: number;
  y: number;
  label: string;
}
export interface EditorDescriptor {
  erase_cell: string;
  constraints?: Constraint[];
}
export type Tool = 'select' | 'paint' | 'fill' | 'erase' | 'pan';
export type Coordinate = [number, number];
export interface TileScene {
  width: number;
  height: number;
  cells: string[][];
}
