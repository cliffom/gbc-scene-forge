export { array, boolean, number, record, string } from '../shared/decode.mts';
export type { Decoder } from '../shared/decode.mts';
import type { Decoder } from '../shared/decode.mts';
/** Decode unknown JSON at transport boundaries, without discarding connector extensions. */
import type {
  ApplyJob,
  AssetEntry,
  AssetRect,
  Catalog,
  Comparison,
  Coordinate,
  Draft,
  LastApply,
  LoadedDocument,
  Preview,
  Profile,
  Review,
  SavedDraft,
  Scene,
  SceneData,
  Validation,
} from './types.ts';

import { array, boolean, number, record, string } from '../shared/decode.mts';
function optional<T>(value: unknown, decode: Decoder<T>): T | undefined {
  return value == null ? undefined : decode(value);
}
function coordinate(value: unknown): Coordinate {
  const items = array(value, number);
  if (items.length !== 2) {
    throw Error('Expected a coordinate pair');
  }
  return [items[0], items[1]];
}
export function scene(value: unknown): Scene {
  const data = record(value);
  const result = {
    ...data,
    version: number(data.version),
    connector: string(data.connector),
    id: string(data.id),
    name: string(data.name),
    profile: string(data.profile),
    source_digest: string(data.source_digest),
    width: number(data.width),
    height: number(data.height),
    cells: array(data.cells, (row) => array(row, string)),
    references: array(data.references, (value) => {
      const ref = record(value);
      return {
        ...ref,
        id: string(ref.id),
        asset: string(ref.asset),
        x: number(ref.x),
        y: number(ref.y),
      };
    }),
  };
  if (
    result.version !== 1 ||
    !Number.isInteger(result.width) ||
    !Number.isInteger(result.height) ||
    result.width <= 0 ||
    result.height <= 0 ||
    result.cells.length !== result.height ||
    result.cells.some((row) => row.length !== result.width)
  ) {
    throw Error('Invalid scene dimensions or version');
  }
  return result;
}
export function loadedDocument(value: unknown): LoadedDocument {
  const data = record(value);
  return {
    scene: scene(data.scene),
    revision: data.revision == null ? null : string(data.revision),
    original: optional(data.original, boolean),
  };
}
export function sceneData(value: unknown): SceneData {
  const data = record(value);
  return {
    ...loadedDocument(value),
    locked: array(data.locked, coordinate),
    constraints: array(data.constraints ?? [], (value) => {
      const item = record(value);
      return { x: number(item.x), y: number(item.y), reason: string(item.reason) };
    }),
    markers: array(data.markers ?? [], (value) => {
      const item = record(value);
      return { x: number(item.x), y: number(item.y), label: string(item.label) };
    }),
  };
}
function profile(value: unknown): Profile {
  const data = record(value);
  const result: Profile = {
    label: string(data.label),
    type: string(data.type),
    cell_size: number(data.cell_size),
    erase_cell: string(data.erase_cell),
    lighting: array(data.lighting, string),
    states: array(data.states, (value) => {
      const state = record(value);
      return { id: string(state.id), label: string(state.label) };
    }),
    animation_frames: optional(data.animation_frames, number),
    animation_interval_ms: optional(data.animation_interval_ms, number),
    animation_label: optional(data.animation_label, string),
    guide: data.guide == null ? null : coordinate(data.guide),
  };
  if (
    !Number.isInteger(result.cell_size) ||
    result.cell_size <= 0 ||
    !result.erase_cell ||
    !result.lighting.length ||
    !result.states.length ||
    (result.animation_frames && !(Number(result.animation_interval_ms) > 0))
  ) {
    throw Error('Invalid connector preview profile');
  }
  return result;
}
function rect(value: unknown): AssetRect {
  const data = record(value);
  return {
    x: number(data.x),
    y: number(data.y),
    width: number(data.width),
    height: number(data.height),
    origin: optional(data.origin, coordinate),
  };
}
function asset(value: unknown): AssetEntry {
  const data = record(value);
  return {
    id: string(data.id),
    label: string(data.label),
    family: string(data.family),
    profiles: array(data.profiles, string),
    rect: optional(data.rect, rect),
    cells: optional(data.cells, (value) => array(value, (row) => array(row, string))),
    reference: optional(data.reference, boolean),
  };
}
export function catalog(value: unknown): Catalog {
  const data = record(value),
    project = record(data.project),
    caps = record(data.capabilities);
  if (data.contract_version !== 1) {
    throw Error('Unsupported connector contract version');
  }
  const profiles = Object.fromEntries(
    Object.entries(record(data.profiles)).map(([key, value]) => [key, profile(value)]),
  );
  if (!Object.keys(profiles).length) {
    throw Error('Connector must provide a scene');
  }
  return {
    contract_version: 1,
    connector: string(data.connector),
    token: string(data.token),
    project: {
      name: string(project.name),
      label: string(project.label),
      source_label: string(project.source_label),
    },
    capabilities: {
      apply: optional(caps.apply, boolean),
      export: optional(caps.export, boolean),
      templates: optional(caps.templates, boolean),
      references: optional(caps.references, boolean),
    },
    profiles,
    families: array(data.families, (value) => {
      const family = record(value);
      return { id: string(family.id), url: string(family.url) };
    }),
    entries: array(data.entries, asset),
  };
}
export function comparison(value: unknown): Comparison {
  const data = record(value);
  return { differs: boolean(data.differs), source_revision: string(data.source_revision) };
}
export function preview(value: unknown): Preview {
  const data = record(value);
  return {
    png: string(data.png),
    collision: array(data.collision, (row) => array(row, boolean)),
    comparison: comparison(data.comparison),
  };
}
export function drafts(value: unknown): Draft[] {
  return array(value, (value) => {
    const data = record(value);
    return {
      id: string(data.id),
      name: string(data.name),
      profile: string(data.profile),
      revision: string(data.revision),
    };
  });
}
export function savedDraft(value: unknown): SavedDraft {
  const data = record(value);
  return { id: string(data.id), revision: string(data.revision), path: string(data.path) };
}
export const originals = (value: unknown): string[] => array(value, string);
export function deletedDrafts(value: unknown): { deleted: string[] } {
  return { deleted: array(record(value).deleted, string) };
}
export function validation(value: unknown): Validation {
  const data = record(value);
  return {
    valid: boolean(data.valid),
    errors: array(data.errors, string),
    warnings: array(data.warnings, string),
  };
}
export function review(value: unknown): Review {
  const data = record(value);
  return {
    id: string(data.id),
    target: string(data.target),
    changed_cells: number(data.changed_cells),
    note: data.note == null ? '' : string(data.note),
    files: array(data.files, string),
    views: array(data.views, (value) => {
      const view = record(value);
      return { label: string(view.label), before: string(view.before), after: string(view.after) };
    }),
  };
}
export function lastApply(value: unknown): LastApply {
  const data = record(value);
  return { transaction: optional(data.transaction, string), label: optional(data.label, string) };
}
export function activeApply(value: unknown): { id?: string } {
  return { id: optional(record(value).id, string) };
}
export function job(value: unknown): ApplyJob {
  const data = record(value);
  const status = data.status;
  if (status !== 'running' && status !== 'failed' && status !== 'complete') {
    throw Error('Unknown Apply status');
  }
  const process = data.process == null ? undefined : record(data.process);
  return {
    status,
    started_at: number(data.started_at),
    id: optional(data.id, string),
    profile: optional(data.profile, string),
    scene: optional(data.scene, scene),
    step: optional(data.step, string),
    activity: optional(data.activity, string),
    message: optional(data.message, string),
    error: optional(data.error, string),
    failed_step: optional(data.failed_step, string),
    log: optional(data.log, string),
    phase_started_at: optional(data.phase_started_at, number),
    ended_at: optional(data.ended_at, number),
    step_index: optional(data.step_index, number),
    step_count: optional(data.step_count, number),
    last_output_at: data.last_output_at == null ? null : number(data.last_output_at),
    server_time: optional(data.server_time, number),
    process: process
      ? {
          running: optional(process.running, boolean),
          command: optional(process.command, string),
          return_code: process.return_code == null ? null : number(process.return_code),
        }
      : undefined,
  };
}
