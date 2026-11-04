/** Sheet/frame navigation and sequence authoring, owned by the artwork lifetime. */
import {
  MAX_FRAMES,
  MAX_SEQUENCES,
  MAX_SEQUENCE_FRAMES,
  MIN_DURATION_MS,
  MAX_DURATION_MS,
} from './sheet-limits.mts';
import type { ArtworkRaster } from './artwork-raster.mts';
import { button, element, input, select } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { ArtworkSession } from './artwork-session.mts';
import { decodeDescriptor, type ArtworkFrame, type ArtworkSequence } from './artwork-contracts.mts';

export function createSheetEditor(
  lifetime: EditorLifetime,
  raster: ArtworkRaster,
  ports: {
    current: () => ArtworkSession | null;
    mutate: (work: () => void) => void;
    draw: () => void;
    review: (sequence: string) => void;
  },
) {
  let playing = false;
  let completed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let position = 0;
  let signature = '';
  let boundDescriptor: object | null = null;
  function descriptor() {
    const d = ports.current()?.model.descriptor;
    return d?.version === 2 ? d : null;
  }
  function selectedFrame() {
    return descriptor()?.frames.find((f) => f.id === select('art-frame').value) ?? null;
  }
  function sequence() {
    return descriptor()?.sequences.find((s) => s.id === select('art-sequence').value) ?? null;
  }
  function view() {
    return input('art-edit-frame').checked ? selectedFrame() : null;
  }
  function compatible(a: ArtworkFrame, b: ArtworkFrame) {
    return (
      a.kind === b.kind &&
      a.width === b.width &&
      a.height === b.height &&
      a.origin.every((n, i) => n === b.origin[i])
    );
  }
  function controls(busy: boolean) {
    const d = descriptor(),
      s = sequence(),
      f = selectedFrame();
    const first = d?.frames.find((frame) => frame.id === s?.frames[0]?.frame_id);
    for (const id of ['art-play', 'art-step', 'art-animation-review', 'art-loop']) {
      const control = id === 'art-loop' ? input(id) : button(id);
      control.disabled = busy || !s;
    }
    input('art-onion').disabled = busy || !view() || f?.kind !== 'sprite';
    button('art-add-animation-frame').disabled =
      busy || !s || !f || !first || !compatible(f, first) || s.frames.length >= MAX_SEQUENCE_FRAMES;
    button('art-add-sequence').disabled = busy || !d || d.sequences.length >= MAX_SEQUENCES;
    button('art-tile-representation').disabled =
      busy || !d || d.frames.length >= MAX_FRAMES || f?.kind !== 'sprite';
  }
  function stop() {
    playing = false;
    lifetime.cancelTimeout(timer);
    timer = undefined;
    button('art-play').textContent = 'Play';
  }
  const rendered = new WeakMap<HTMLCanvasElement, string>();
  function image(frame: ArtworkFrame, target: HTMLCanvasElement, repetitions = 1) {
    const stamp = raster.stamp(frame, repetitions);
    if (rendered.get(target) === stamp) {
      return;
    }
    const context = target.getContext('2d');
    if (!context) {
      return;
    }
    const scale = Math.min(8, 256 / Math.max(frame.width, frame.height));
    const width = frame.width * scale * repetitions,
      height = frame.height * scale * repetitions;
    if (target.width !== width) {
      target.width = width;
    }
    if (target.height !== height) {
      target.height = height;
    }
    context.reset();
    rendered.set(target, stamp);
    context.imageSmoothingEnabled = false;
    for (let y = 0; y < repetitions; y++) {
      for (let x = 0; x < repetitions; x++) {
        context.drawImage(
          raster.canvas,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
          x * frame.width * scale,
          y * frame.height * scale,
          frame.width * scale,
          frame.height * scale,
        );
      }
    }
  }
  function preview() {
    const d = descriptor(),
      s = sequence(),
      f = selectedFrame();
    if (!d) {
      const source = ports.current()?.model.descriptor;
      const repeat = element('art-repeat-canvas', HTMLCanvasElement);
      repeat.hidden = source?.kind !== 'tile';
      if (source?.kind === 'tile') {
        image({ ...source, x: 0, y: 0 }, repeat, 3);
      }
      return;
    }
    const item = s?.frames[position % s.frames.length];
    const frame = d.frames.find((value) => value.id === item?.frame_id) ?? f;
    if (frame) {
      image(frame, element('art-animation-canvas', HTMLCanvasElement));
    }
    element('art-animation-status', HTMLElement).textContent =
      s && item
        ? `${s.name} · frame ${position + 1}/${s.frames.length} · ${item.duration_ms} ms`
        : 'Choose or create an animation.';
    const repeat = element('art-repeat-canvas', HTMLCanvasElement);
    repeat.hidden = f?.kind !== 'tile';
    if (f?.kind === 'tile') {
      image(f, repeat, 3);
    }
  }
  function tick() {
    const s = sequence();
    if (!playing || !s || document.hidden) {
      stop();
      return;
    }
    preview();
    timer = lifetime.timeout(() => {
      if (position + 1 >= s.frames.length && !s.loop) {
        completed = true;
        stop();
        return;
      }
      position = (position + 1) % s.frames.length;
      tick();
    }, s.frames[position].duration_ms);
  }
  function edit(work: (d: NonNullable<ReturnType<typeof descriptor>>) => void) {
    stop();
    const before = descriptor();
    const frame = select('art-frame').value;
    const sequence = select('art-sequence').value;
    ports.mutate(() => {
      const d = descriptor();
      if (d) {
        work(d);
        // Throw inside the history transaction so a rejected layout rolls back
        // without losing valid pixels, checkpoint state or the Redo stack.
        decodeDescriptor(d);
      }
    });
    if (descriptor() !== before) {
      // Rollback replaces the descriptor; restore navigation as well as data.
      select('art-frame').value = frame;
      select('art-sequence').value = sequence;
    }
    signature = '';
    sync();
  }
  function rows(s: ArtworkSequence | null) {
    const target = element('art-sequence-frames', HTMLElement);
    target.replaceChildren();
    const d = descriptor();
    if (!s || !d) {
      return;
    }
    for (let index = 0; index < s.frames.length; index++) {
      const item = s.frames[index],
        row = document.createElement('div');
      row.className = 'art-row';
      const choice = document.createElement('select');
      choice.setAttribute('aria-label', `Frame ${index + 1} artwork`);
      choice.replaceChildren(
        ...d.frames
          .filter((f) => {
            const current = d.frames.find((f) => f.id === item.frame_id);
            return current && compatible(f, current);
          })
          .map((f) => new Option(f.name, f.id)),
      );
      choice.value = item.frame_id;
      lifetime.assign(choice, 'onchange', () =>
        edit(() => {
          item.frame_id = choice.value;
        }),
      );
      const duration = document.createElement('input');
      duration.type = 'number';
      duration.min = String(MIN_DURATION_MS);
      duration.max = String(MAX_DURATION_MS);
      duration.value = String(item.duration_ms);
      duration.setAttribute('aria-label', `Frame ${index + 1} duration in milliseconds`);
      lifetime.assign(duration, 'onchange', () => {
        const n = Number(duration.value);
        if (Number.isInteger(n) && n >= MIN_DURATION_MS && n <= MAX_DURATION_MS) {
          edit(() => {
            item.duration_ms = n;
          });
        }
      });
      const thumbnail = document.createElement('canvas');
      thumbnail.setAttribute('aria-hidden', 'true');
      thumbnail.dataset.frame = item.frame_id;
      const unit = document.createElement('span');
      unit.textContent = 'ms';
      row.append(thumbnail, choice, duration, unit);
      for (const [label, delta] of [
        ['Up', -1],
        ['Down', 1],
        ['Remove', 0],
      ] as const) {
        const control = document.createElement('button');
        control.textContent = label;
        control.disabled =
          delta === 0
            ? s.frames.length === 1
            : index + delta < 0 || index + delta >= s.frames.length;
        control.dataset.unavailable = String(control.disabled);
        control.setAttribute('aria-label', `${label} animation frame ${index + 1}`);
        lifetime.assign(control, 'onclick', () =>
          edit(() => {
            if (delta === 0) {
              s.frames.splice(index, 1);
            } else {
              [s.frames[index], s.frames[index + delta]] = [
                s.frames[index + delta],
                s.frames[index],
              ];
            }
          }),
        );
        row.append(control);
      }
      target.append(row);
    }
  }
  function sync(rebind = false) {
    const current = ports.current();
    if (current) {
      raster.refresh(current.model);
    }
    const d = descriptor();
    element('art-sheet-controls', HTMLElement).hidden = !d;
    if (!d) {
      boundDescriptor = null;
      stop();
      preview();
      return;
    }
    const next = JSON.stringify(d);
    // Undo/Redo can replace the descriptor with equal content. Rebind row
    // callbacks to that live object rather than editing a detached snapshot.
    if (rebind || next !== signature || d !== boundDescriptor) {
      // Pending ticks capture the previous sequence. Retire them before history
      // restoration can replace its frames or change the selected sequence.
      stop();
      const f = select('art-frame'),
        s = select('art-sequence');
      const oldFrame = f.value,
        oldSequence = s.value;
      f.replaceChildren(...d.frames.map((frame) => new Option(frame.name, frame.id)));
      if (d.frames.some((frame) => frame.id === oldFrame)) {
        f.value = oldFrame;
      }
      s.replaceChildren(...d.sequences.map((value) => new Option(value.name, value.id)));
      if (d.sequences.some((value) => value.id === oldSequence)) {
        s.value = oldSequence;
      }
      input('art-loop').checked = sequence()?.loop ?? true;
      position = 0;
      completed = false;
      rows(sequence());
      signature = next;
      boundDescriptor = d;
      const frame = selectedFrame();
      input('art-frame-name').value = frame?.name ?? '';
      element('art-frame-geometry', HTMLElement).textContent = frame
        ? `${frame.width} × ${frame.height} · origin ${frame.origin.join(', ')}`
        : '';
    }
    const model = ports.current()?.model;
    if (model) {
      model.bounds = view();
      const bounds = model.bounds,
        selection = model.selection;
      // History restores sheet coordinates, while frame navigation stays local
      // to the current view. Keep only selections fully inside that frame.
      if (
        bounds &&
        selection &&
        (selection.x < bounds.x ||
          selection.y < bounds.y ||
          selection.x + selection.width > bounds.x + bounds.width ||
          selection.y + selection.height > bounds.y + bounds.height)
      ) {
        model.selection = null;
      }
    }
    const strip = element('art-frame-strip', HTMLElement);
    if (strip.dataset.frames !== d.frames.map((f) => f.id).join(',')) {
      strip.replaceChildren(
        ...d.frames.map((frame) => {
          const control = document.createElement('button');
          control.dataset.frame = frame.id;
          control.append(document.createElement('canvas'), document.createElement('span'));
          lifetime.assign(control, 'onclick', () => {
            select('art-frame').value = frame.id;
            select('art-frame').dispatchEvent(new Event('change'));
          });
          return control;
        }),
      );
      strip.dataset.frames = d.frames.map((f) => f.id).join(',');
    }
    for (const control of strip.querySelectorAll<HTMLButtonElement>('button')) {
      const frame = d.frames.find((f) => f.id === control.dataset.frame);
      if (!frame) {
        continue;
      }
      control.setAttribute('aria-label', `Select ${frame.name} frame`);
      control.setAttribute('aria-pressed', String(frame.id === selectedFrame()?.id));
      const label = control.querySelector('span'),
        thumbnail = control.querySelector('canvas');
      if (label && label.textContent !== frame.name) {
        label.textContent = frame.name;
      }
      if (thumbnail) {
        image(frame, thumbnail);
      }
    }
    button('art-sheet-view').setAttribute('aria-pressed', String(!view()));
    button('art-frame-view').setAttribute('aria-pressed', String(Boolean(view())));
    input('art-onion').disabled = !view() || selectedFrame()?.kind !== 'sprite';
    const selected = selectedFrame();
    input('art-frame-name').value = selected?.name ?? '';
    element('art-frame-geometry', HTMLElement).textContent = selected
      ? `${selected.width} × ${selected.height} · origin ${selected.origin.join(', ')}`
      : '';
    paint(false);
    controls(false);
  }
  /** During a gesture only pixels/overlays change; navigation and row bindings
   * remain stable until completion/cancellation performs a full synchronization. */
  function paint(refresh = true) {
    const current = ports.current();
    if (refresh && current) {
      raster.refresh(current.model);
    }
    const d = descriptor();
    if (!d) {
      preview();
      return;
    }
    const frames = new Map(d.frames.map((frame) => [frame.id, frame]));
    for (const control of element('art-frame-strip', HTMLElement).querySelectorAll('button')) {
      const frame = frames.get(control.dataset.frame ?? '');
      const thumbnail = control.querySelector('canvas');
      if (frame && thumbnail) {
        image(frame, thumbnail);
      }
    }
    const timeline = element('art-sequence-frames', HTMLElement);
    if (!timeline.closest('details:not([open])')) {
      for (const thumbnail of timeline.querySelectorAll('canvas')) {
        const frame = frames.get(thumbnail.dataset.frame ?? '');
        if (frame) {
          image(frame, thumbnail);
        }
      }
    }
    preview();
  }
  for (const [id, frame] of [
    ['art-sheet-view', false],
    ['art-frame-view', true],
  ] as const) {
    lifetime.assign(button(id), 'onclick', () => {
      input('art-edit-frame').checked = frame;
      input('art-edit-frame').dispatchEvent(new Event('change'));
    });
  }
  for (const id of ['art-frame', 'art-edit-frame', 'art-onion']) {
    const control = id === 'art-frame' ? select(id) : input(id);
    lifetime.assign(control, 'onchange', () => {
      stop();
      const model = ports.current()?.model;
      if (model) {
        model.selection = null;
      }
      sync();
      const frame = selectedFrame();
      input('art-frame-name').value = frame?.name ?? '';
      element('art-frame-geometry', HTMLElement).textContent = frame
        ? `${frame.width} × ${frame.height} · origin ${frame.origin.join(', ')}`
        : '';
      ports.draw();
    });
  }
  lifetime.assign(select('art-sequence'), 'onchange', () => {
    stop();
    position = 0;
    completed = false;
    input('art-loop').checked = sequence()?.loop ?? true;
    rows(sequence());
    paint();
    controls(false);
  });
  lifetime.assign(button('art-add-sequence'), 'onclick', () =>
    edit((d) => {
      const name = input('art-sequence-id').value.trim();
      const id = name
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '');
      const f = selectedFrame();
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(id) || d.sequences.some((s) => s.id === id) || !f) {
        throw Error('Use a unique animation name beginning with a letter, and choose a frame.');
      }
      d.sequences.push({
        id,
        name,
        loop: true,
        frames: [{ frame_id: f.id, duration_ms: 120 }],
      });
      select('art-sequence').append(new Option(id, id));
      select('art-sequence').value = id;
    }),
  );
  lifetime.assign(button('art-rename-frame'), 'onclick', () =>
    edit(() => {
      const frame = selectedFrame(),
        name = input('art-frame-name').value.trim();
      if (!name || name.length > 100) {
        throw Error('Use a frame name of 1..100 characters.');
      }
      if (frame) {
        frame.name = name;
      }
    }),
  );
  lifetime.assign(button('art-add-animation-frame'), 'onclick', () =>
    edit(() => {
      const s = sequence(),
        f = selectedFrame();
      if (s && f && s.frames.length < MAX_SEQUENCE_FRAMES) {
        s.frames.push({ frame_id: f.id, duration_ms: 120 });
      }
    }),
  );
  lifetime.assign(input('art-loop'), 'onchange', () =>
    edit(() => {
      const s = sequence();
      if (s) {
        s.loop = input('art-loop').checked;
      }
    }),
  );
  lifetime.assign(button('art-play'), 'onclick', () => {
    if (playing) {
      stop();
    } else if (sequence()) {
      if (completed) {
        position = 0;
        completed = false;
      }
      playing = true;
      button('art-play').textContent = 'Pause';
      tick();
    }
  });
  lifetime.assign(button('art-step'), 'onclick', () => {
    stop();
    completed = false;
    const s = sequence();
    if (s) {
      position = (position + 1) % s.frames.length;
    }
    preview();
  });
  lifetime.assign(button('art-animation-review'), 'onclick', () => {
    const s = sequence();
    if (s) {
      ports.review(s.id);
    }
  });
  lifetime.assign(button('art-tile-representation'), 'onclick', () =>
    edit((d) => {
      const f = selectedFrame();
      if (!f) {
        return;
      }
      const id = `${f.id.slice(0, 48)}_tiles`;
      if (d.frames.some((frame) => frame.id === id)) {
        throw Error('This tile representation already exists.');
      }
      let name = f.name;
      // Reserve the suffix within the shared name limit, keeping Unicode intact.
      while (name.length > 94) {
        name = Array.from(name).slice(0, -1).join('');
      }
      d.frames.push({
        ...structuredClone(f),
        id,
        name: `${name.trimEnd()} tiles`,
        kind: 'tile',
        origin: [0, 0],
      });
    }),
  );
  const dock = element('art-dock', HTMLDetailsElement);
  dock.addEventListener(
    'toggle',
    () => {
      if (!dock.open) {
        stop();
      } else {
        paint();
      }
    },
    { signal: lifetime.signal },
  );
  const timeline = element('art-sequence-frames', HTMLElement).closest('details');
  timeline?.addEventListener(
    'toggle',
    () => {
      if (timeline.open) {
        // Revealing deferred images must preserve the owner's busy controls.
        paint();
      }
    },
    { signal: lifetime.signal },
  );
  lifetime.cleanup(() => {
    stop();
    // The host reuses static editor markup across mounts. Retire backing stores
    // and old row callbacks, including strips with equal frame IDs on remount.
    for (const id of ['art-frame-strip', 'art-sequence-frames']) {
      const container = element(id, HTMLElement);
      for (const canvas of container.querySelectorAll('canvas')) {
        canvas.width = canvas.height = 0;
      }
      container.replaceChildren();
      delete container.dataset.frames;
    }
    for (const id of ['art-animation-canvas', 'art-repeat-canvas']) {
      const canvas = element(id, HTMLCanvasElement);
      canvas.width = canvas.height = 0;
    }
  });
  return { sync, paint, view, stop, selectedFrame, controls };
}
