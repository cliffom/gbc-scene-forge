/** Persisted preferences deliberately exclude progress, paths and live positions. */
import type { PreviewAction, PreviewDirection } from './animation-preview.mts';
import { boolean, number, record, string } from './decode.mts';
export interface SpritePreviewSettings {
  playback_speed: number;
  show_origin: boolean;
  movement_speed: number;
  footprint: { x: number; y: number; width: number; height: number };
  check_collisions: boolean;
  mappings: Record<string, Record<string, string>>;
  selections: Record<
    string,
    { action: 'manual' | PreviewAction; direction: PreviewDirection; sequence: string }
  >;
}
export function decodePreviewSettings(value: unknown): SpritePreviewSettings {
  const data = record(value);
  const footprint = record(data.footprint);
  const selections: SpritePreviewSettings['selections'] = {};
  for (const [asset, value] of Object.entries(record(data.selections))) {
    const item = record(value);
    const action = item.action;
    const direction = item.direction;
    if (
      (action !== 'manual' && action !== 'idle' && action !== 'walk') ||
      (direction !== 'up' && direction !== 'down' && direction !== 'left' && direction !== 'right')
    ) {
      throw Error('Invalid preview selection');
    }
    selections[asset] = { action, direction, sequence: string(item.sequence) };
  }
  return {
    playback_speed: number(data.playback_speed),
    show_origin: boolean(data.show_origin),
    movement_speed: number(data.movement_speed),
    check_collisions: boolean(data.check_collisions),
    footprint: {
      x: number(footprint.x),
      y: number(footprint.y),
      width: number(footprint.width),
      height: number(footprint.height),
    },
    mappings: Object.fromEntries(
      Object.entries(record(data.mappings)).map(([asset, value]) => [
        asset,
        Object.fromEntries(
          Object.entries(record(value)).map(([slot, name]) => [slot, string(name)]),
        ),
      ]),
    ),
    selections,
  };
}

export function prunePreviewSettings(
  settings: SpritePreviewSettings,
  available: Record<string, string[]>,
): SpritePreviewSettings {
  const result = structuredClone(settings);
  for (const [asset, entries] of Object.entries(result.mappings)) {
    if (!Object.hasOwn(available, asset)) {
      delete result.mappings[asset];
      continue;
    }
    result.mappings[asset] = Object.fromEntries(
      Object.entries(entries).filter(([, name]) => available[asset].includes(name)),
    );
  }
  for (const [asset, entry] of Object.entries(result.selections)) {
    if (!Object.hasOwn(available, asset)) {
      delete result.selections[asset];
      continue;
    }
    if (!available[asset].includes(entry.sequence)) {
      entry.sequence = '';
    }
  }
  return result;
}
