import { EditorLifetime } from '../editor/editor-lifetime.mts';
/** Spatial world editing stays separate from the open scene's undo history. */
import type { Connection, Endpoint, World, WorldSnapshot } from './world.mts';
import { worldFindings } from './world.mts';
const get = (id: string) => {
  const node = document.getElementById(id);
  if (!node) {
    throw Error(`Missing ${id}`);
  }
  return node;
};
function typed<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = get(id);
  if (!(node instanceof type)) {
    throw Error(`Invalid ${id}`);
  }
  return node;
}
const input = (id: string) => typed(id, HTMLInputElement);
const select = (id: string) => typed(id, HTMLSelectElement);
const button = (id: string) => typed(id, HTMLButtonElement);
export function createWorldView(
  load: () => Promise<{ world: World; snapshot: WorldSnapshot; revision: string }>,
  save: (world: World, revisions: Record<string, string>, revision: string) => Promise<string>,
  navigate: (endpoint: Endpoint) => void,
  lifetime: EditorLifetime = new EditorLifetime(),
) {
  const dialog = typed('world-dialog', HTMLDialogElement),
    form = typed('world-link-form', HTMLFormElement);
  function mapElement(): SVGSVGElement {
    const node = document.getElementById('world-map');
    if (!(node instanceof SVGSVGElement)) {
      throw Error('Missing world map');
    }
    return node;
  }
  const svg = mapElement();
  let world: World = { version: 1, positions: {}, connections: [] },
    snapshot: WorldSnapshot = { scenes: [], revisions: {} };
  let selected = '',
    linkId = '',
    working = false,
    changed = false;
  let drag: { id: string; start: DOMPoint; x: number; y: number; pointer: number } | null = null;
  let original = '';
  let revision = '';
  let fitted = false;
  let moved = false;
  let pan: { pointer: number; start: DOMPoint } | null = null;
  function point(x: number, y: number) {
    const matrix = svg.getScreenCTM();
    if (!matrix) {
      throw Error('World map is not visible.');
    }
    return new DOMPoint(x, y).matrixTransform(matrix.inverse());
  }
  function zoom(factor: number, anchor: DOMPoint) {
    const box = svg.viewBox.baseVal;
    const ratio = Math.min(1000000, Math.max(100, box.width * factor)) / box.width;
    svg.setAttribute(
      'viewBox',
      [
        anchor.x + (box.x - anchor.x) * ratio,
        anchor.y + (box.y - anchor.y) * ratio,
        box.width * ratio,
        box.height * ratio,
      ].join(' '),
    );
  }
  svg.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      if (!drag && !pan) {
        zoom(Math.exp(Math.sign(event.deltaY) * 0.15), point(event.clientX, event.clientY));
      }
    },
    { passive: false, signal: lifetime.signal },
  );
  function card(target: EventTarget | null) {
    return target instanceof Element ? target.closest<SVGGElement>('g[data-scene]') : null;
  }
  svg.addEventListener(
    'pointerdown',
    (event) => {
      if (working || !event.isPrimary || event.button !== 0) {
        return;
      }
      const node = card(event.target);
      const id = node?.dataset.scene;
      const start = point(event.clientX, event.clientY);
      if (node && id) {
        event.preventDefault();
        choose(id);
        node.focus({ preventScroll: true });
        drag = { id, start, ...position(id), pointer: event.pointerId };
        moved = false;
      } else {
        pan = { pointer: event.pointerId, start };
        lifetime.capture(svg, event.pointerId);
      }
    },
    { signal: lifetime.signal },
  );
  svg.addEventListener(
    'dblclick',
    (event) => {
      const id = card(event.target)?.dataset.scene;
      if (id && !working && !moved) {
        follow({ scene: id, object: 0 });
      }
    },
    { signal: lifetime.signal },
  );
  svg.addEventListener(
    'keydown',
    (event) => {
      const id = card(event.target)?.dataset.scene;
      if (!working && id && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        choose(id);
        button('world-open').focus();
      }
    },
    { signal: lifetime.signal },
  );
  for (const [id, factor] of [
    ['world-zoom-in', 0.8],
    ['world-zoom-out', 1.25],
  ] as const) {
    lifetime.assign(button(id), 'onclick', () => {
      const box = svg.viewBox.baseVal;
      zoom(factor, new DOMPoint(box.x + box.width / 2, box.y + box.height / 2));
    });
  }
  lifetime.assign(button('world-fit'), 'onclick', () => renderMap(true));
  function controls() {
    if (lifetime.disposed) {
      return;
    }
    for (const control of dialog.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    >('button,input,select')) {
      control.disabled = working || control.dataset.unavailable === 'true';
    }
    button('world-save').disabled ||= !changed;
    button('world-open').disabled ||= !selected;
    input('world-x').disabled ||= !selected;
    input('world-y').disabled ||= !selected;
    get('world-state').textContent = working
      ? 'Saving…'
      : changed
        ? 'Unsaved world changes'
        : 'World saved';
  }
  function touch() {
    changed = JSON.stringify(world) !== original;
    controls();
  }
  function error(error: unknown) {
    if (lifetime.disposed) {
      return;
    }
    get('world-error').textContent = error instanceof Error ? error.message : String(error);
  }
  function position(id: string) {
    return (
      world.positions[id] ?? {
        x: (snapshot.scenes.findIndex((s) => s.id === id) % 4) * 240,
        y: Math.floor(snapshot.scenes.findIndex((s) => s.id === id) / 4) * 160,
      }
    );
  }
  function choose(id: string) {
    selected = id;
    const p = position(id);
    input('world-x').value = id ? String(p.x) : '';
    input('world-y').value = id ? String(p.y) : '';
    const scene = snapshot.scenes.find((s) => s.id === id);
    get('world-selected').textContent = scene?.name ?? 'No scenes yet';
    get('world-scene-info').textContent = scene
      ? `${scene.width} × ${scene.height} cells · ${scene.grid}px grid`
      : 'Use the scene workspace to create your first scene.';
    for (const node of svg.querySelectorAll('[data-scene]')) {
      node.setAttribute('aria-pressed', String(node.getAttribute('data-scene') === selected));
    }
    controls();
  }
  function make<K extends keyof SVGElementTagNameMap>(
    tag: K,
    attributes: Record<string, string>,
    text?: string,
  ) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attributes)) {
      node.setAttribute(k, v);
    }
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }
  function renderMap(fit = false) {
    svg.replaceChildren();
    const defs = make('defs', {}),
      marker = make('marker', {
        id: 'world-arrow',
        viewBox: '0 0 10 10',
        refX: '9',
        refY: '5',
        markerWidth: '7',
        markerHeight: '7',
        orient: 'auto-start-reverse',
      });
    marker.append(make('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#88badb' }));
    defs.append(marker);
    svg.append(defs);
    if (fit || !fitted) {
      fitted = true;
      const ps = snapshot.scenes.map((s) => position(s.id));
      const left = Math.min(0, ...ps.map((p) => p.x)) - 40,
        top = Math.min(0, ...ps.map((p) => p.y)) - 40;
      svg.setAttribute(
        'viewBox',
        `${left} ${top} ${Math.max(700, ...ps.map((p) => p.x + 230 - left))} ${Math.max(300, ...ps.map((p) => p.y + 140 - top))}`,
      );
    }
    for (const link of world.connections) {
      const exists = (id: string) => snapshot.scenes.some((s) => s.id === id);
      if (!exists(link.source.scene) || !exists(link.destination.scene)) {
        continue;
      }
      const a = position(link.source.scene),
        b = position(link.destination.scene);
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const scale = Math.max(Math.abs(dx) / 105, Math.abs(dy) / 55, 1);
      const offset = { x: dx / scale, y: dy / scale };
      const path =
        link.source.scene === link.destination.scene
          ? `M ${a.x + 50} ${a.y} C ${a.x + 20} ${a.y - 70}, ${a.x + 180} ${a.y - 70}, ${a.x + 150} ${a.y}`
          : `M ${a.x + 100 + offset.x} ${a.y + 50 + offset.y} L ${b.x + 100 - offset.x} ${b.y + 50 - offset.y}`;
      const line = make('path', {
        d: path,
        fill: 'none',
        stroke: '#88badb',
        'stroke-width': '3',
        'marker-end': 'url(#world-arrow)',
        ...(link.direction === 'two-way' ? { 'marker-start': 'url(#world-arrow)' } : {}),
      });
      line.append(make('title', {}, `${link.name}: ${link.direction}`));
      svg.append(line);
    }
    for (const scene of snapshot.scenes) {
      const p = position(scene.id),
        node = make('g', {
          transform: `translate(${p.x} ${p.y})`,
          'data-scene': scene.id,
          role: 'button',
          tabindex: '0',
          'aria-label': `Select ${scene.name}`,
          'aria-pressed': String(scene.id === selected),
        });
      node.append(
        make('rect', { width: '200', height: '100', rx: '10' }),
        make(
          'text',
          { x: '14', y: '30' },
          scene.name.length > 23 ? scene.name.slice(0, 22) + '…' : scene.name,
        ),
        make(
          'text',
          { x: '14', y: '56', class: 'world-meta' },
          `${scene.width} × ${scene.height} · ${scene.grid}px`,
        ),
        make('text', { x: '14', y: '80', class: 'world-meta' }, `${scene.objects.length} objects`),
        make('title', {}, scene.name),
      );
      svg.append(node);
    }
  }
  svg.addEventListener(
    'pointermove',
    (event) => {
      if (pan?.pointer === event.pointerId) {
        const current = point(event.clientX, event.clientY);
        const box = svg.viewBox.baseVal;
        box.x += pan.start.x - current.x;
        box.y += pan.start.y - current.y;
        return;
      }
      if (!drag || drag.pointer !== event.pointerId || working) {
        return;
      }
      const matrix = svg.getScreenCTM();
      if (!matrix) {
        return;
      }
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      if (!moved) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * matrix.a < 4) {
          return;
        }
        moved = true;
        lifetime.capture(svg, event.pointerId);
      }
      world.positions[drag.id] = {
        x: Math.max(-100000, Math.min(100000, Math.round(drag.x + p.x - drag.start.x))),
        y: Math.max(-100000, Math.min(100000, Math.round(drag.y + p.y - drag.start.y))),
      };
      choose(drag.id);
      touch();
      renderMap(false);
    },
    { signal: lifetime.signal },
  );
  const stopDrag = (event: PointerEvent) => {
    if (pan?.pointer === event.pointerId) {
      pan = null;
    }
    if (drag?.pointer === event.pointerId) {
      drag = null;
    }
  };
  svg.addEventListener(
    'pointerleave',
    (event) => {
      if (!svg.hasPointerCapture(event.pointerId)) {
        stopDrag(event);
      }
    },
    { signal: lifetime.signal },
  );
  svg.addEventListener('pointerup', stopDrag, { signal: lifetime.signal });
  svg.addEventListener('pointercancel', stopDrag, { signal: lifetime.signal });
  svg.addEventListener('lostpointercapture', stopDrag, { signal: lifetime.signal });
  lifetime.assign(button('world-position'), 'onclick', () => {
    const x = input('world-x').valueAsNumber,
      y = input('world-y').valueAsNumber;
    if (!selected || ![x, y].every((n) => Number.isInteger(n) && Math.abs(n) <= 100000)) {
      error('Enter whole coordinates within -100000..100000.');
      return;
    }
    world.positions[selected] = { x, y };
    touch();
    renderMap();
  });
  function options(side: 'source' | 'destination', endpoint?: Endpoint) {
    const scenes = select(`world-${side}-scene`),
      objects = select(`world-${side}-object`);
    if (endpoint) {
      scenes.replaceChildren(...snapshot.scenes.map((s) => new Option(s.name, s.id)));
      if (!snapshot.scenes.some((s) => s.id === endpoint.scene)) {
        scenes.add(new Option(`Missing scene ${endpoint.scene}`, endpoint.scene));
      }
      scenes.value = endpoint.scene;
    }
    const scene = snapshot.scenes.find((s) => s.id === scenes.value);
    objects.replaceChildren(
      ...(scene?.objects ?? []).map(
        (o) =>
          new Option(
            `${o.name || '#' + o.id} · #${o.id}${o.visible ? '' : ' · hidden'}${o.errors.length ? ' · invalid definition' : ''}`,
            String(o.id),
          ),
      ),
    );
    if (endpoint) {
      if (!scene?.objects.some((o) => o.id === endpoint.object)) {
        objects.add(new Option(`Missing object #${endpoint.object}`, String(endpoint.object)));
      }
      objects.value = String(endpoint.object);
    }
  }
  for (const side of ['source', 'destination'] as const) {
    lifetime.assign(select(`world-${side}-scene`), 'onchange', () => options(side));
  }
  function edit(link?: Connection) {
    linkId = link?.id ?? '';
    input('world-link-name').value = link?.name ?? '';
    select('world-direction').value = link?.direction ?? 'one-way';
    for (const [i, side] of (['source', 'destination'] as const).entries()) {
      const scene = snapshot.scenes[i] ?? snapshot.scenes[0];
      select(`world-${side}-scene`).replaceChildren(
        ...snapshot.scenes.map((s) => new Option(s.name, s.id)),
      );
      if (link) {
        options(side, link[side]);
      } else {
        select(`world-${side}-scene`).value = scene?.id ?? '';
        options(side);
      }
    }
    button('world-link-apply').textContent = link ? 'Update connection' : 'Add connection';
  }
  function action(text: string, fn: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.className = 'small';
    lifetime.assign(b, 'onclick', fn);
    return b;
  }
  function follow(endpoint: Endpoint) {
    if (!snapshot.scenes.some((s) => s.id === endpoint.scene)) {
      error('The endpoint scene is missing. Edit this connection to choose a replacement.');
      return;
    }
    dialog.close();
    navigate(endpoint);
  }
  function renderLinks() {
    const list = get('world-links');
    list.replaceChildren();
    const label = (e: Endpoint) => {
      const scene = snapshot.scenes.find((s) => s.id === e.scene),
        object = scene?.objects.find((o) => o.id === e.object);
      return `${scene?.name ?? 'Missing scene'} / ${object?.name || '#' + e.object}`;
    };
    for (const link of world.connections) {
      const row = document.createElement('div');
      row.className = 'world-link';
      row.dataset.connection = link.id;
      const title = document.createElement('strong');
      title.textContent = link.name;
      const desc = document.createElement('span');
      desc.textContent = `${label(link.source)} ${link.direction === 'two-way' ? '↔' : '→'} ${label(link.destination)}`;
      row.append(
        title,
        desc,
        action('Edit', () => edit(link)),
        action('Source', () => follow(link.source)),
        action(link.direction === 'two-way' ? 'Follow ↔' : 'Follow →', () =>
          follow(link.destination),
        ),
        action('Remove', () => {
          world.connections = world.connections.filter((l) => l.id !== link.id);
          touch();
          renderLinks();
          renderMap();
          edit();
        }),
      );
      list.append(row);
    }
    if (!world.connections.length) {
      list.textContent = 'No connections yet. Choose exit and entrance objects below.';
    }
    const findings = get('world-findings');
    findings.replaceChildren();
    const descriptions: Record<string, string> = {
      'missing-scene': 'Scene is missing. Choose a replacement.',
      'missing-object': 'Object was removed. Choose a replacement.',
      'missing-definition': 'Attach an existing object definition.',
      kind: 'Object shape does not match its definition.',
      required: 'Required field is missing or empty.',
      type: 'Override type does not match its definition.',
      min: 'Value is below the defined minimum.',
      max: 'Value exceeds the defined maximum.',
      choices: 'Value is outside the defined choices.',
      'unknown-field': 'Override field is absent from its definition.',
    };
    for (const f of worldFindings(world, snapshot.scenes)) {
      const name = world.connections.find((l) => l.id === f.connection)?.name ?? '';
      const b = action(
        `${name} / ${f.endpoint}${f.field ? ' / ' + f.field : ''}: ${descriptions[f.code] ?? f.code}`,
        () => follow({ scene: f.scene, object: f.object }),
      );
      b.disabled = !snapshot.scenes.some((s) => s.id === f.scene);
      b.dataset.unavailable = String(b.disabled);
      b.dataset.code = f.code;
      findings.append(b);
    }
    if (!findings.children.length) {
      findings.textContent = 'All connection endpoints are valid.';
    }
  }
  lifetime.assign(form, 'onsubmit', (event) => {
    event.preventDefault();
    if (working) {
      return;
    }
    const endpoint = (side: string): Endpoint => ({
      scene: select(`world-${side}-scene`).value,
      object: Number(select(`world-${side}-object`).value),
    });
    const source = endpoint('source'),
      destination = endpoint('destination'),
      name = input('world-link-name').value.trim();
    if (
      !name ||
      !source.scene ||
      !destination.scene ||
      !source.object ||
      !destination.object ||
      (source.scene === destination.scene && source.object === destination.object)
    ) {
      error('Choose a name and two distinct object endpoints.');
      return;
    }
    if (!linkId && world.connections.length >= 4096) {
      error('Use at most 4096 connections.');
      return;
    }
    const direction = select('world-direction').value;
    if (direction !== 'one-way' && direction !== 'two-way') {
      return;
    }
    const link: Connection = {
      id: linkId || crypto.randomUUID(),
      name,
      source,
      destination,
      direction,
    };
    const index = world.connections.findIndex((l) => l.id === link.id);
    if (index < 0) {
      world.connections.push(link);
    } else {
      world.connections[index] = link;
    }
    get('world-error').textContent = '';
    touch();
    renderLinks();
    renderMap();
    edit();
  });
  lifetime.assign(button('world-link-new'), 'onclick', () => edit());
  lifetime.assign(button('world-save'), 'onclick', async () => {
    if (working) {
      return;
    }
    working = true;
    controls();
    try {
      const candidate = structuredClone(world);
      for (const scene of snapshot.scenes) {
        candidate.positions[scene.id] = position(scene.id);
      }
      revision = await save(candidate, snapshot.revisions, revision);
      world = candidate;
      original = JSON.stringify(world);
      changed = false;
      get('world-error').textContent = '';
    } catch (e) {
      error(e);
    } finally {
      working = false;
      controls();
    }
  });
  function discard() {
    return !changed || window.confirm('Discard unsaved world layout and connection changes?');
  }
  lifetime.assign(button('world-close'), 'onclick', () => {
    if (!working && discard()) {
      changed = false;
      dialog.close();
    }
  });
  lifetime.assign(dialog, 'oncancel', (event) => {
    if (working || !discard()) {
      event.preventDefault();
    } else {
      changed = false;
    }
  });
  lifetime.assign(button('world-open'), 'onclick', () => {
    if (selected) {
      follow({ scene: selected, object: 0 });
    }
  });
  window.addEventListener(
    'beforeunload',
    (event) => {
      if (changed) {
        event.preventDefault();
        event.returnValue = '';
      }
    },
    { signal: lifetime.signal },
  );
  return {
    async open(activeScene?: string, projectEntry = false) {
      try {
        get('world-error').textContent = '';
        const data = await load().catch((cause: unknown) => {
          if (!changed) {
            throw cause;
          }
          // Keep the captured draft accessible for inspection or explicit discard.
          error(cause);
          return null;
        });
        if (lifetime.disposed) {
          return;
        }
        if (data) {
          const savedWorld = JSON.stringify(data.world);
          if (!changed) {
            world = structuredClone(data.world);
            original = savedWorld;
          }
          // A placement-only draft is independent of tile edits saved during a scene visit.
          // Never advance its guards over a changed world or a removed scene.
          const placementOnly =
            savedWorld === original &&
            JSON.stringify(world.connections) === JSON.stringify(data.world.connections) &&
            Object.keys(world.positions).every((id) => Object.hasOwn(data.snapshot.revisions, id));
          if (
            !changed ||
            placementOnly ||
            (revision === data.revision &&
              Object.entries(snapshot.revisions).every(
                ([id, base]) => data.snapshot.revisions[id] === base,
              ))
          ) {
            snapshot = data.snapshot;
            revision = data.revision;
          } else {
            error(
              'The saved project changed during this world edit. Close the map and discard the world draft to reload the saved layout.',
            );
          }
        }
        const preferred = activeScene ?? selected;
        selected = snapshot.scenes.some((s) => s.id === preferred)
          ? preferred
          : (snapshot.scenes[0]?.id ?? '');
        drag = null;
        pan = null;
        renderMap();
        renderLinks();
        edit();
        choose(selected);
        button('world-close').textContent = projectEntry ? 'Scene workspace' : 'Close map';
        dialog.showModal();
        svg.querySelector<SVGElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
      } catch (e) {
        error(e);
        throw e;
      }
    },
  };
}
