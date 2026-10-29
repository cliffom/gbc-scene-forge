import { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { PreviewWorld } from './movement-preview.mts';
import { createMovementPreview } from './movement-preview.mts';
import type { SpritePreviewSettings } from './preview-settings.mts';

/** Transient playback only: this module never receives an editor or scene writer. */
export interface SpriteRegion {
  name: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  origin: [number, number];
}
export interface SpriteAnimation {
  name: string;
  frames: { region: string; duration: number }[];
}

export const previewActions = ['idle', 'walk'] as const;
export const previewDirections = ['down', 'left', 'right', 'up'] as const;
export type PreviewAction = (typeof previewActions)[number];
export type PreviewDirection = (typeof previewDirections)[number];

/** Explicit mappings are scoped to a sprite asset and remain independent of scene objects. */
export class SequenceMappings {
  private assets = new Map<string, Map<string, string>>();

  set(asset: string, action: PreviewAction, direction: PreviewDirection, sequence: string) {
    let entries = this.assets.get(asset);
    if (!entries) {
      entries = new Map();
      this.assets.set(asset, entries);
    }
    const key = `${action}:${direction}`;
    if (sequence) {
      entries.set(key, sequence);
    } else {
      entries.delete(key);
    }
  }
  get(asset: string, action: PreviewAction, direction: PreviewDirection): string {
    return this.assets.get(asset)?.get(`${action}:${direction}`) || '';
  }
  snapshot(): Record<string, Record<string, string>> {
    return Object.fromEntries(
      [...this.assets].map(([asset, entries]) => [asset, Object.fromEntries(entries)]),
    );
  }
  restore(value: Record<string, Record<string, string>>) {
    this.assets = new Map(
      Object.entries(value).map(([asset, entries]) => [asset, new Map(Object.entries(entries))]),
    );
  }
  retain(asset: string, sequences: string[]) {
    const valid = new Set(sequences);
    const entries = this.assets.get(asset);
    for (const [key, name] of entries || []) {
      if (!valid.has(name)) {
        entries?.delete(key);
      }
    }
  }
}

export class AnimationPlayback {
  animation: SpriteAnimation | null = null;
  frame = 0;
  playing = false;
  speed = 1;
  private elapsed = 0;

  choose(animation: SpriteAnimation | null) {
    this.animation = animation;
    this.frame = 0;
    this.elapsed = 0;
    this.playing = false;
  }
  step(direction: number) {
    this.playing = false;
    this.elapsed = 0;
    const count = this.animation?.frames.length || 1;
    this.frame = (this.frame + direction + count) % count;
  }
  advance(milliseconds: number): boolean {
    if (!this.playing || !this.animation) {
      return false;
    }
    const frames = this.animation.frames;
    const cycle = frames.reduce((sum, frame) => sum + frame.duration, 0);
    this.elapsed += (milliseconds * this.speed) % cycle;
    const previous = this.frame;
    while (this.elapsed >= frames[this.frame].duration) {
      this.elapsed -= frames[this.frame].duration;
      this.frame = (this.frame + 1) % frames.length;
    }
    return previous !== this.frame;
  }
}

export function createAnimationPreview(
  redraw: () => void,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  function control<T extends HTMLElement>(id: string, type: new () => T): T {
    const element = document.getElementById(id);
    if (!(element instanceof type)) {
      throw Error(`Missing element ${id}`);
    }
    return element;
  }
  const panel = control('animation-preview', HTMLElement);
  const sequence = control('preview-animation', HTMLSelectElement);
  const play = control('preview-play', HTMLButtonElement);
  const previous = control('preview-previous', HTMLButtonElement);
  const next = control('preview-next', HTMLButtonElement);
  const speed = control('preview-speed', HTMLSelectElement);
  const origin = control('preview-origin', HTMLInputElement);
  const detail = control('preview-frame', HTMLElement);
  const canvas = control('selection-image', HTMLCanvasElement);
  const mode = control('preview-action', HTMLSelectElement);
  const facing = control('preview-direction', HTMLSelectElement);
  const mappingStatus = control('preview-mapping-status', HTMLElement);
  const mappings = new SequenceMappings();
  const mappingControls = previewActions.flatMap((action) =>
    previewDirections.map((direction) => ({
      action,
      direction,
      select: control(`preview-map-${action}-${direction}`, HTMLSelectElement),
    })),
  );
  let manualSequence = '';
  let selections: SpritePreviewSettings['selections'] = {};
  function action(): PreviewAction | null {
    return previewActions.find((action) => action === mode.value) || null;
  }
  function direction(): PreviewDirection {
    return previewDirections.find((direction) => direction === facing.value) || 'down';
  }
  const playback = new AnimationPlayback();
  let target: {
    key: string;
    asset: string;
    image: HTMLImageElement;
    region: SpriteRegion;
    regions: SpriteRegion[];
    animations: SpriteAnimation[];
    origin?: [number, number];
    start: { x: number; y: number };
    world: PreviewWorld;
  } | null = null;
  let signature = '';
  let timer: number | undefined;
  let lastTime = 0;
  let wasMovingPreview = false;
  let movementSelection: { key: string; action: string; direction: string } | null = null;
  const movement = createMovementPreview(() => {
    syncMovement();
    refresh();
    ensureTimer();
  }, lifetime);
  function syncMovement() {
    if (!movement.active) {
      if (wasMovingPreview) {
        if (target && movementSelection && target.key === movementSelection.key) {
          mode.value = movementSelection.action;
          facing.value = movementSelection.direction;
          const mappedAction = action();
          const name =
            mappedAction && target
              ? mappings.get(target.asset, mappedAction, direction())
              : manualSequence;
          playback.choose(target?.animations.find((animation) => animation.name === name) || null);
        } else {
          playback.playing = false;
        }
        movementSelection = null;
      }
      wasMovingPreview = false;
      return;
    }
    if (!wasMovingPreview) {
      movementSelection = { key: target?.key || '', action: mode.value, direction: facing.value };
      movement.model.initialDirection = direction();
      movement.model.direction = direction();
    }
    wasMovingPreview = true;
    if (movement.model.paused) {
      playback.playing = false;
      return;
    }
    mode.value = movement.model.moving ? 'walk' : 'idle';
    facing.value = movement.model.direction;
    const name = target ? mappings.get(target.asset, action() || 'idle', direction()) : '';
    const animation = target?.animations.find((animation) => animation.name === name) || null;
    if (animation !== playback.animation) {
      playback.choose(animation);
    }
    playback.playing = !!animation;
  }
  function ensureTimer() {
    if (timer === undefined && (playback.playing || movement.active)) {
      lastTime = performance.now();
      timer = lifetime.frame(tick);
    }
  }
  function frame() {
    return (
      target?.regions.find(
        (region) => region.name === playback.animation?.frames[playback.frame].region,
      ) || target?.region
    );
  }
  function render() {
    if (!target) {
      return;
    }
    const region = frame();
    if (!region) {
      return;
    }
    const pivot = target.origin || region.origin;
    canvas.width = region.width;
    canvas.height = region.height;
    canvas.style.width = `${region.width * 3}px`;
    canvas.style.height = `${region.height * 3}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.drawImage(
      target.image,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );
    if (origin.checked) {
      ctx.strokeStyle = '#f2d67b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pivot[0] - 3, pivot[1] + 0.5);
      ctx.lineTo(pivot[0] + 4, pivot[1] + 0.5);
      ctx.moveTo(pivot[0] + 0.5, pivot[1] - 3);
      ctx.lineTo(pivot[0] + 0.5, pivot[1] + 4);
      ctx.stroke();
    }
    const mappedAction = action();
    sequence.disabled = !target.animations.length || !!mappedAction;
    facing.disabled = !mappedAction || movement.active;
    mode.disabled = movement.active;
    sequence.value = playback.animation?.name || '';
    mappingStatus.textContent = mappedAction
      ? playback.animation
        ? `${mappedAction} / ${direction()} → ${playback.animation.name}`
        : `No sequence mapped for ${mappedAction} / ${direction()}. Showing the saved sprite.`
      : 'Choose an animation directly, or preview a mapped action and direction.';
    play.textContent = playback.playing ? 'Pause' : 'Play';
    play.disabled = previous.disabled = next.disabled = !playback.animation || movement.active;
    detail.textContent = playback.animation
      ? `Frame ${playback.frame + 1} / ${playback.animation.frames.length} · ${region.name} · ${playback.animation.frames[playback.frame].duration} ms · Origin ${pivot.join(', ')}${target.origin ? ' (instance)' : ' (atlas)'}`
      : `Static frame · Origin ${pivot.join(', ')}${target.origin ? ' (instance)' : ' (atlas)'}`;
  }
  function refresh() {
    render();
    redraw();
  }
  function stopTimer() {
    if (timer !== undefined) {
      lifetime.cancelFrame(timer);
    }
    timer = undefined;
  }
  document.addEventListener(
    'visibilitychange',
    () => {
      lastTime = performance.now();
    },
    { signal: lifetime.signal },
  );
  function tick(time: number) {
    timer = undefined;
    if (!playback.playing && !movement.active) {
      return;
    }
    if (!document.hidden) {
      const previousPosition = movement.model.position;
      const previousState = `${movement.model.direction}:${movement.model.moving}:${movement.model.blocked}:${movement.model.path.length}`;
      movement.tick(time - lastTime);
      syncMovement();
      const changed = playback.advance(time - lastTime);
      if (
        changed ||
        (movement.active &&
          (previousPosition !== movement.model.position ||
            previousState !==
              `${movement.model.direction}:${movement.model.moving}:${movement.model.blocked}:${movement.model.path.length}`))
      ) {
        refresh();
      }
    }
    lastTime = time;
    timer = lifetime.frame(tick);
  }
  function chooseSequence() {
    stopTimer();
    const mappedAction = action();
    const name =
      mappedAction && target
        ? mappings.get(target.asset, mappedAction, direction())
        : manualSequence;
    playback.choose(target?.animations.find((animation) => animation.name === name) || null);
    syncMovement();
    refresh();
    ensureTimer();
  }
  function rememberSelection() {
    if (target && !movement.active) {
      selections[target.asset] = {
        action: action() || 'manual',
        direction: direction(),
        sequence: manualSequence,
      };
    }
  }
  lifetime.assign(sequence, 'onchange', () => {
    manualSequence = sequence.value;
    rememberSelection();
    chooseSequence();
  });
  lifetime.assign(
    mode,
    'onchange',
    lifetime.assign(facing, 'onchange', () => {
      rememberSelection();
      chooseSequence();
    }),
  );
  for (const entry of mappingControls) {
    lifetime.assign(entry.select, 'onchange', () => {
      if (!target) {
        return;
      }
      mappings.set(target.asset, entry.action, entry.direction, entry.select.value);
      if (action() === entry.action && direction() === entry.direction) {
        chooseSequence();
      }
    });
  }
  lifetime.assign(play, 'onclick', () => {
    playback.playing = !playback.playing;
    stopTimer();
    lastTime = performance.now();
    if (playback.playing) {
      timer = lifetime.frame(tick);
    }
    render();
  });
  lifetime.assign(previous, 'onclick', () => {
    stopTimer();
    playback.step(-1);
    refresh();
  });
  lifetime.assign(next, 'onclick', () => {
    stopTimer();
    playback.step(1);
    refresh();
  });
  lifetime.assign(speed, 'onchange', () => {
    playback.speed = Number(speed.value);
  });
  lifetime.assign(origin, 'onchange', refresh);
  return {
    configure(value: typeof target) {
      const nextSignature = value
        ? JSON.stringify([value.key, value.region, value.animations])
        : '';
      target = value;
      movement.configure(value ? { key: value.key, start: value.start, world: value.world } : null);
      panel.hidden = !value;
      if (signature !== nextSignature) {
        signature = nextSignature;
        stopTimer();
        playback.choose(null);
        const saved = value ? selections[value.asset] : undefined;
        manualSequence = saved?.sequence || '';
        mode.value = saved?.action || 'manual';
        facing.value = saved?.direction || 'down';
        if (value) {
          mappings.retain(
            value.asset,
            value.animations.map((animation) => animation.name),
          );
        }
        for (const entry of mappingControls) {
          entry.select.replaceChildren(
            new Option('Unmapped', ''),
            ...(value?.animations.map((animation) => new Option(animation.name, animation.name)) ||
              []),
          );
          entry.select.value = value
            ? mappings.get(value.asset, entry.action, entry.direction)
            : '';
          entry.select.disabled = !value?.animations.length;
        }
        sequence.replaceChildren(
          new Option('Static frame', ''),
          ...(value?.animations.map((animation) => new Option(animation.name, animation.name)) ||
            []),
        );
        sequence.disabled = !value?.animations.length;
        const mappedAction = action();
        const selectedName =
          value && mappedAction
            ? mappings.get(value.asset, mappedAction, direction())
            : manualSequence;
        playback.choose(
          value?.animations.find((animation) => animation.name === selectedName) || null,
        );
      }
      syncMovement();
      render();
      ensureTimer();
    },
    settings(): SpritePreviewSettings {
      return {
        playback_speed: playback.speed,
        show_origin: origin.checked,
        ...movement.preferences(),
        mappings: mappings.snapshot(),
        selections: structuredClone(selections),
      };
    },
    restore(settings: SpritePreviewSettings) {
      mappings.restore(settings.mappings);
      selections = structuredClone(settings.selections);
      speed.value = String(settings.playback_speed);
      playback.speed = settings.playback_speed;
      origin.checked = settings.show_origin;
      movement.restore(settings);
      signature = '';
    },
    movement,
    frame: (key: string) => (target?.key === key ? frame() : undefined),
    reset() {
      movement.reset();
      wasMovingPreview = false;
      movementSelection = null;
      signature = '';
      target = null;
      playback.choose(null);
      stopTimer();
      panel.hidden = true;
    },
  };
}
