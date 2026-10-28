/** Shared tile editing types and the remaining legacy connector transport types. */
export interface SceneReference {
  id: string;
  asset: string;
  x: number;
  y: number;
  [key: string]: unknown;
}

export interface Scene {
  version: number;
  connector: string;
  id: string;
  name: string;
  profile: string;
  source_digest: string;
  width: number;
  height: number;
  cells: string[][];
  references: SceneReference[];
  [key: string]: unknown;
}

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
export type Tool = 'select' | 'paint' | 'fill' | 'erase' | 'pan';
export type Coordinate = [number, number];
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
export interface Profile extends EditorDescriptor {
  label: string;
  type: string;
  cell_size: number;
  lighting: string[];
  states: { id: string; label: string }[];
  animation_frames?: number;
  animation_interval_ms?: number;
  animation_label?: string;
  guide?: Coordinate | null;
}
export interface AssetRect {
  x: number;
  y: number;
  width: number;
  height: number;
  origin?: Coordinate;
}
export interface AssetEntry {
  id: string;
  label: string;
  family: string;
  profiles: string[];
  rect?: AssetRect;
  cells?: string[][];
  reference?: boolean;
}
export interface Brush extends AssetEntry {
  available: boolean;
}
export interface Catalog {
  contract_version: number;
  connector: string;
  token: string;
  project: { name: string; label: string; source_label: string };
  capabilities: { apply?: boolean; export?: boolean; templates?: boolean; references?: boolean };
  profiles: Record<string, Profile>;
  families: { id: string; url: string }[];
  entries: AssetEntry[];
}
export interface LoadedDocument {
  scene: Scene;
  revision: string | null;
  original?: boolean;
}
export interface SceneData extends LoadedDocument {
  locked: Coordinate[];
  constraints: Constraint[];
  markers: Marker[];
}
export interface Comparison {
  differs: boolean;
  source_revision: string;
}
export interface Preview {
  png: string;
  collision: boolean[][];
  comparison: Comparison;
}
export interface Draft {
  id: string;
  name: string;
  profile: string;
  revision: string;
}
export interface SavedDraft {
  id: string;
  revision: string;
  path: string;
}
export interface Validation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
export interface Review {
  id: string;
  target: string;
  changed_cells: number;
  note: string;
  files: string[];
  views: { label: string; before: string; after: string }[];
}
export interface LastApply {
  transaction?: string;
  label?: string;
}
export interface ApplyJob {
  status: 'running' | 'failed' | 'complete';
  started_at: number;
  id?: string;
  profile?: string;
  scene?: Scene;
  step?: string;
  activity?: string;
  message?: string;
  error?: string;
  failed_step?: string;
  log?: string;
  phase_started_at?: number;
  ended_at?: number;
  step_index?: number;
  step_count?: number;
  last_output_at?: number | null;
  server_time?: number;
  process?: { running?: boolean; command?: string; return_code?: number | null };
}
export type Gesture = (
  | { type: 'pan'; x: number; y: number; left: number; top: number }
  | { type: 'reference'; p: Point; ref: SceneReference }
  | { type: 'move' | 'selection'; p: Point }
  | { type: 'paint'; last: string | null }
) & { current?: Point };

/** Mutation payloads are checked at call sites; imported JSON stays unknown until the server normalizes it. */
export interface MutationRequests {
  preview: { scene: Scene; light: string; state: string; frame: number };
  validate: { scene: Scene };
  document: { scene: Scene };
  export: { scene: Scene };
  import: { scene: unknown };
  new: { profile: string };
  save: { scene: Scene; saved_id?: string | null; revision?: string | null };
  'delete-drafts': { drafts: { id: string; revision: string }[] };
  'apply-review': { scene: Scene };
  apply: { review: string; approved: boolean };
  'apply-dismiss': { job: string };
  'undo-apply': { transaction: string; profile: string };
}
export type ReadRoute =
  | 'catalog'
  | 'drafts'
  | 'originals'
  | 'last-apply'
  | 'apply-active'
  | `scene/${string}`
  | `original/${string}`
  | `draft/${string}`
  | `apply-status/${string}`;
export type ApiRoute = ReadRoute | keyof MutationRequests;
