/** Sheet/frame navigation and sequence authoring, owned by the artwork lifetime. */
import { button, element, input, select } from '../editor/editor-dom.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { ArtworkSession } from './artwork-session.mts';
import type { ArtworkFrame, ArtworkSequence } from './artwork-contracts.mts';

export function createSheetEditor(
  lifetime: EditorLifetime,
  ports: {
    current: () => ArtworkSession | null;
    mutate: (work: () => void) => void;
    draw: () => void;
    review: (sequence: string) => void;
  },
) {
  let playing = false;
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
    button('art-add-animation-frame').disabled =
      busy || !s || !f || !first || !compatible(f, first) || s.frames.length >= 256;
    button('art-add-sequence').disabled = busy || !d || d.sequences.length >= 64;
    button('art-tile-representation').disabled =
      busy || !d || d.frames.length >= 128 || f?.kind !== 'sprite';
  }
  function stop() {
    playing = false;
    lifetime.cancelTimeout(timer);
    timer = undefined;
    button('art-play').textContent = 'Play';
  }
  function image(frame: ArtworkFrame, target: HTMLCanvasElement, repetitions = 1) {
    const model = ports.current()?.model;
    const context = target.getContext('2d');
    if (!model || !context) {
      return;
    }
    const source = document.createElement('canvas');
    source.width = model.width;
    source.height = model.height;
    source
      .getContext('2d')
      ?.putImageData(
        new ImageData(new Uint8ClampedArray(model.pixels), model.width, model.height),
        0,
        0,
      );
    const scale = Math.min(8, 256 / Math.max(frame.width, frame.height));
    target.width = frame.width * scale * repetitions;
    target.height = frame.height * scale * repetitions;
    context.imageSmoothingEnabled = false;
    for (let y = 0; y < repetitions; y++) {
      for (let x = 0; x < repetitions; x++) {
        context.drawImage(
          source,
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
        stop();
        return;
      }
      position = (position + 1) % s.frames.length;
      tick();
    }, s.frames[position].duration_ms);
  }
  function edit(work: (d: NonNullable<ReturnType<typeof descriptor>>) => void) {
    stop();
    ports.mutate(() => {
      const d = descriptor();
      if (d) {
        work(d);
      }
    });
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
      duration.min = '1';
      duration.max = '65535';
      duration.value = String(item.duration_ms);
      duration.setAttribute('aria-label', `Frame ${index + 1} duration in milliseconds`);
      lifetime.assign(duration, 'onchange', () => {
        const n = Number(duration.value);
        if (Number.isInteger(n) && n >= 1 && n <= 65535) {
          edit(() => {
            item.duration_ms = n;
          });
        }
      });
      row.append(choice, duration);
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
  function sync() {
    const d = descriptor();
    element('art-sheet-controls', HTMLElement).hidden = !d;
    if (!d) {
      boundDescriptor = null;
      stop();
      return;
    }
    const next = JSON.stringify(d);
    // Undo/Redo can replace the descriptor with equal content. Rebind row
    // callbacks to that live object rather than editing a detached snapshot.
    if (next !== signature || d !== boundDescriptor) {
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
    }
    preview();
    controls(false);
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
    input('art-loop').checked = sequence()?.loop ?? true;
    rows(sequence());
    preview();
    controls(false);
  });
  lifetime.assign(button('art-add-sequence'), 'onclick', () =>
    edit((d) => {
      const id = input('art-sequence-id').value;
      const f = selectedFrame();
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(id) || d.sequences.some((s) => s.id === id) || !f) {
        throw Error('Choose a unique lowercase sequence ID and a frame.');
      }
      d.sequences.push({
        id,
        name: id,
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
      if (s && f && s.frames.length < 256) {
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
      playing = true;
      button('art-play').textContent = 'Pause';
      tick();
    }
  });
  lifetime.assign(button('art-step'), 'onclick', () => {
    stop();
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
      d.frames.push({
        ...structuredClone(f),
        id,
        name: `${f.name} tiles`,
        kind: 'tile',
        origin: [0, 0],
      });
    }),
  );
  lifetime.cleanup(stop);
  return { sync, view, stop, selectedFrame, controls };
}
