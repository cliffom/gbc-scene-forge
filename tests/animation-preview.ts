import assert from 'node:assert/strict';
import { decodePreviewSettings, prunePreviewSettings } from '../frontend/preview-settings.mts';
import { AnimationPlayback, SequenceMappings } from '../frontend/animation-preview.mts';

const playback = new AnimationPlayback();
const animation = {
  name: 'walk',
  frames: [
    { region: 'left', duration: 100 },
    { region: 'right', duration: 250 },
  ],
};
playback.choose(animation);
assert.equal(playback.advance(100), false);
playback.playing = true;
assert.equal(playback.advance(99), false);
assert.equal(playback.advance(1), true);
assert.equal(playback.frame, 1);
playback.advance(249);
assert.equal(playback.frame, 1);
playback.advance(1);
assert.equal(playback.frame, 0);
playback.speed = 2;
playback.advance(50);
assert.equal(playback.frame, 1);
playback.step(1);
assert.equal(playback.frame, 0);
assert.equal(playback.playing, false);
playback.step(-1);
assert.equal(playback.frame, 1);
playback.playing = true;
playback.advance((350 * 1000000) / 2 + 125);
assert.equal(playback.frame, 0);
playback.choose(null);
assert.equal(playback.frame, 0);
assert.equal(playback.playing, false);
assert.equal(playback.advance(999), false);
assert.deepEqual(animation.frames, [
  { region: 'left', duration: 100 },
  { region: 'right', duration: 250 },
]);
console.log('Animation timing, speed, stepping, looping and reset checks passed.');

const mappings = new SequenceMappings();
assert.equal(mappings.get('actors/hero', 'idle', 'down'), '');
mappings.set('actors/hero', 'idle', 'down', 'rest_south');
mappings.set('actors/hero', 'walk', 'left', 'stride_west');
assert.equal(mappings.get('actors/hero', 'idle', 'down'), 'rest_south');
assert.equal(mappings.get('actors/hero', 'walk', 'left'), 'stride_west');
assert.equal(mappings.get('actors/hero', 'walk', 'down'), '');
assert.equal(mappings.get('actors/other', 'idle', 'down'), '');
mappings.set('actors/hero', 'idle', 'down', '');
assert.equal(mappings.get('actors/hero', 'idle', 'down'), '');
mappings.set('actors/hero', 'idle', 'up', 'rest_north');
mappings.retain('actors/hero', ['stride_west']);
assert.equal(mappings.get('actors/hero', 'idle', 'up'), '');
assert.equal(mappings.get('actors/hero', 'walk', 'left'), 'stride_west');
console.log(
  'Explicit sequence mappings: action/direction isolation, asset scope, clearing and reimport pruning pass.',
);

const restoredMappings = new SequenceMappings();
restoredMappings.restore(mappings.snapshot());
assert.equal(restoredMappings.get('actors/hero', 'walk', 'left'), 'stride_west');
const settings = decodePreviewSettings({
  playback_speed: 2,
  show_origin: false,
  movement_speed: 64,
  footprint: { x: -3, y: -4, width: 6, height: 8 },
  check_collisions: true,
  mappings: {
    'actors/hero': { 'idle:down': 'removed', 'walk:left': 'stride_west' },
    'removed/asset': { 'idle:down': 'rest' },
  },
  selections: { 'actors/hero': { action: 'manual', direction: 'left', sequence: 'removed' } },
});
const pruned = prunePreviewSettings(settings, { 'actors/hero': ['stride_west'] });
assert.deepEqual(pruned.mappings, { 'actors/hero': { 'walk:left': 'stride_west' } });
assert.equal(pruned.selections['actors/hero'].sequence, '');
assert.equal(settings.selections['actors/hero'].sequence, 'removed');
assert.equal(pruned.playback_speed, 2);
assert.deepEqual(pruned.footprint, { x: -3, y: -4, width: 6, height: 8 });
assert.throws(() => decodePreviewSettings({ ...settings, check_collisions: 1 }));
assert.throws(() =>
  decodePreviewSettings({
    ...settings,
    selections: { 'actors/hero': { action: 'run', direction: 'left', sequence: '' } },
  }),
);
console.log('Preview preference decoding, mapping restoration and stale-reference pruning pass.');
