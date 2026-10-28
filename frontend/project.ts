/** Standalone project controller; editing operations share the connector editor model. */
import { Editor } from './model.mts';
import { chooseFolder, readBundle } from './atlas-import.mts';
import type { AtlasFolder } from './atlas-import.mts';
import { array, boolean, number, record, string } from './decode.mts';
import type { Decoder } from './decode.mts';
import type { Scene, SceneReference, Selection } from './types.ts';

interface Region {
  name: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  origin: [number, number];
}
interface Atlas {
  png: string;
  regions: Region[];
  mappings: Record<string, Record<string, number>>;
}
interface Project {
  name: string;
  scenes: { id: string; name: string }[];
  atlases: Record<string, Atlas>;
}
interface Loaded {
  id: string;
  name: string;
  revision: string;
  width: number;
  height: number;
  grid: number;
  cells: string[][];
  objects: { id: number; asset: string; x: number; y: number }[];
  nextObjectId: number;
}
function element<T extends HTMLElement>(id: string, type: new () => T): T {
  const result = document.getElementById(id);
  if (!(result instanceof type)) {
    throw Error(`Missing element ${id}`);
  }
  return result;
}
const button = (id: string) => element(id, HTMLButtonElement);
const input = (id: string) => element(id, HTMLInputElement);
const select = (id: string) => element(id, HTMLSelectElement);
const form = (id: string) => element(id, HTMLFormElement);
const canvas = element('scene', HTMLCanvasElement);
const ctx = canvas.getContext('2d');
if (!ctx) {
  throw Error('Canvas rendering is unavailable');
}
const context = ctx;
const status = element('status', HTMLElement);
let token = '';
let atlasFolder: AtlasFolder | null = null;
let revision = '';
let project: Project | null = null;
let loaded: Loaded | null = null;
let editor: Editor | null = null;
let baseline = '';
let brush: string[][] | null = null;
let spriteBrush: string | null = null;
let selectedSprite: string | null = null;
let spriteDrag: { id: string; x: number; y: number } | null = null;
let selection: Selection | null = null;
let anchor: { x: number; y: number; px: number; py: number } | null = null;
let hover: ReturnType<typeof point> | null = null;
let deleteCandidate: {
  id: string;
  name: string;
  revision: string;
  projectRevision: string;
} | null = null;
let deleteAtlasCandidate: { id: string; projectRevision: string } | null = null;
let busy = false;
let pan: { x: number; y: number; left: number; top: number } | null = null;
const images = new Map<string, HTMLImageElement>();
const regions = new Map<string, { image: HTMLImageElement; x: number; y: number }>();
const sprites = new Map<string, { image: HTMLImageElement; region: Region }>();

async function api<T>(route: string, decode: Decoder<T>, data?: unknown): Promise<T> {
  const response = await fetch(`/api/${route}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers:
      data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Scene-Token': token },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw Error(string(record(body).error));
  }
  return decode(body);
}
function decodeLoaded(value: unknown): Loaded {
  const data = record(value);
  const scene = record(data.scene);
  const result = {
    id: string(data.id),
    name: string(data.name),
    revision: string(data.revision),
    width: number(scene.width),
    height: number(scene.height),
    grid: number(scene.grid),
    cells: array(scene.cells, (row) => array(row, string)),
    objects: array(scene.objects ?? [], (value) => {
      const item = record(value);
      return {
        id: number(item.id),
        asset: string(item.asset),
        x: number(item.x),
        y: number(item.y),
      };
    }),
    nextObjectId: number(scene.next_object_id ?? 1),
  };
  if (
    !Number.isInteger(result.width) ||
    !Number.isInteger(result.height) ||
    result.width < 1 ||
    result.width > 256 ||
    result.height < 1 ||
    result.height > 256 ||
    ![8, 16, 32].includes(result.grid) ||
    result.cells.length !== result.height ||
    result.cells.some((row) => row.length !== result.width)
  ) {
    throw Error('Invalid scene response');
  }
  return result;
}
function decodeProject(value: unknown): Project {
  const data = record(value);
  const atlases: Record<string, Atlas> = {};
  for (const [id, item] of Object.entries(record(data.atlases))) {
    const entry = record(item);
    const mappings: Record<string, Record<string, number>> = {};
    for (const [grid, map] of Object.entries(record(entry.tiles))) {
      mappings[grid] = Object.fromEntries(
        Object.entries(record(map)).map(([k, v]) => [k, number(v)]),
      );
    }
    atlases[id] = {
      png: string(entry.png),
      mappings,
      regions: array(record(entry.manifest).regions, (value) => {
        const r = record(value);
        const origin = array(r.origin ?? [0, 0], number);
        if (origin.length !== 2) {
          throw Error('Invalid region origin');
        }
        return {
          name: string(r.name),
          kind: string(r.kind),
          x: number(r.x),
          y: number(r.y),
          width: number(r.width),
          height: number(r.height),
          origin: [origin[0], origin[1]],
        };
      }),
    };
  }
  return {
    name: string(data.name),
    atlases,
    scenes: array(data.scenes, (value) => {
      const scene = record(value);
      return { id: string(scene.id), name: string(scene.name) };
    }),
  };
}
function snapshot() {
  return editor
    ? JSON.stringify({
        cells: editor.scene.cells,
        objects: editor.scene.references,
        next: editor.scene.next_object_id,
      })
    : '';
}
function dirty() {
  return snapshot() !== baseline;
}
async function discard(): Promise<boolean> {
  if (!dirty()) {
    return true;
  }
  const dialog = element('discard-dialog', HTMLDialogElement);
  if (dialog.open) {
    return false;
  }
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), {
      once: true,
    });
    dialog.returnValue = '';
    dialog.showModal();
  });
}
function update() {
  element('dirty', HTMLElement).textContent = !editor ? 'NO SCENE' : dirty() ? 'UNSAVED' : 'SAVED';
  element('dirty', HTMLElement).dataset.dirty = String(dirty());
  button('save').disabled = busy || !editor || !dirty();
  button('undo').disabled = busy || !editor?.undoStack.length;
  button('redo').disabled = busy || !editor?.redoStack.length;
  button('revert').disabled = busy || !dirty();
  button('deselect').disabled = busy || (!selection && !selectedSprite);
  button('remove-sprite').disabled =
    busy || !selectedSprite || !editor?.scene.references.some((r) => r.id === selectedSprite);
  for (const id of ['paint', 'erase', 'fill', 'select', 'pan']) {
    const control = document.querySelector<HTMLInputElement>(`input[value="${id}"]`);
    if (control) {
      control.disabled = busy || !editor || (id === 'fill' && spriteBrush !== null);
    }
  }
  for (const control of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement
  >('#project-form button, #import-form button, #scene-form button, #open, #scenes')) {
    control.disabled = busy;
  }
  button('open').disabled = busy || !select('scenes').value;
  button('show-delete').disabled = busy || !select('scenes').value;
  button('delete-scene-confirm').disabled = busy || !deleteCandidate;
  button('delete-scene-cancel').disabled = busy;
  button('delete-atlas-confirm').disabled =
    busy ||
    !deleteAtlasCandidate ||
    Boolean(editor && deleteAtlasCandidate && usesAtlas(editor.scene, deleteAtlasCandidate.id));
  button('delete-atlas-cancel').disabled = busy;
  element('atlas-list', HTMLElement)
    .querySelectorAll('button')
    .forEach((button) => {
      button.disabled = busy;
    });
  inspect();
}
function inspect() {
  input('inspector-name').value = loaded?.name || '';
  input('inspector-size').value = loaded ? `${loaded.width} × ${loaded.height} cells` : '';
  input('inspector-grid').value = loaded ? `${loaded.grid} px` : '';
  element('scene-summary', HTMLElement).textContent =
    loaded && editor
      ? `${loaded.width * loaded.grid} × ${loaded.height * loaded.grid} pixels · ${editor.scene.references.length} ${editor.scene.references.length === 1 ? 'sprite' : 'sprites'}`
      : 'Open a scene to inspect its dimensions and placed sprites.';
  const item = editor?.scene.references.find((r) => r.id === selectedSprite);
  const sprite = item && sprites.get(item.asset);
  element('selection-preview', HTMLElement).hidden = !sprite;
  if (item && sprite) {
    const r = sprite.region;
    element('selection-kind', HTMLElement).textContent = 'SPRITE';
    element('selection-name', HTMLElement).textContent = item.asset.replace('/', ' / ');
    element('selection-detail', HTMLElement).textContent =
      `${r.width} × ${r.height}px · X ${item.x}, Y ${item.y} · Origin ${r.origin[0]}, ${r.origin[1]}`;
    const preview = element('selection-image', HTMLCanvasElement);
    preview.width = r.width;
    preview.height = r.height;
    preview.style.width = `${r.width * 3}px`;
    preview.style.height = `${r.height * 3}px`;
    preview
      .getContext('2d')
      ?.drawImage(sprite.image, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
  } else if (selection) {
    element('selection-kind', HTMLElement).textContent = 'TILES';
    element('selection-name', HTMLElement).textContent = `${selection.w} × ${selection.h} cells`;
    element('selection-detail', HTMLElement).textContent =
      `Column ${selection.x}, row ${selection.y}. Arrow keys move the selection; Delete erases it.`;
  } else {
    element('selection-kind', HTMLElement).textContent = '—';
    element('selection-name', HTMLElement).textContent = 'Nothing selected';
    element('selection-detail', HTMLElement).textContent =
      'Select a sprite on the canvas to inspect it, or drag a rectangle to select tiles.';
  }
}
async function run(work: () => Promise<void>) {
  if (busy) {
    return;
  }
  busy = true;
  status.dataset.state = '';
  document.querySelectorAll('.form-error').forEach((item) => {
    item.textContent = '';
  });
  update();
  try {
    await work();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.state = 'error';
    const errorField =
      document.querySelector('dialog[open] .form-error') ||
      (!project && document.querySelector('#project-form .form-error'));
    if (errorField) {
      errorField.textContent = status.textContent;
    }
  } finally {
    busy = false;
    update();
  }
}
async function refresh() {
  const data = await api('project', record);
  token = string(data.token);
  project = data.project === null ? null : decodeProject(data.project);
  revision = data.project === null ? '' : string(data.revision);
  form('project-form').hidden = project !== null;
  element('workspace', HTMLElement).hidden = project === null;
  element('project-name', HTMLElement).textContent = project?.name || 'Create a project';
  document.title = `${project?.name || 'New project'} · Scene Forge`;
  const previous = select('scenes').value;
  select('scenes').replaceChildren(
    new Option('Choose a scene…', ''),
    ...(project?.scenes.map((s) => new Option(s.name, s.id)) || []),
  );
  select('scenes').value = project?.scenes.some((item) => item.id === previous) ? previous : '';
  images.clear();
  for (const [id, atlas] of Object.entries(project?.atlases || {})) {
    const image = new Image();
    image.src = `/${atlas.png}?revision=${encodeURIComponent(revision)}`;
    await image.decode();
    images.set(id, image);
  }
  const filter = select('atlas-filter');
  const previousAtlas = filter.value;
  filter.replaceChildren(
    new Option('All atlases', ''),
    ...Object.keys(project?.atlases || {}).map((id) => new Option(id, id)),
  );
  filter.value = project?.atlases[previousAtlas] ? previousAtlas : '';
  const atlasList = element('atlas-list', HTMLElement);
  atlasList.replaceChildren();
  for (const [id, atlas] of Object.entries(project?.atlases || {})) {
    const row = document.createElement('div');
    row.className = 'atlas-row';
    const label = document.createElement('span');
    label.textContent = `${id} · ${atlas.regions.length} ${atlas.regions.length === 1 ? 'region' : 'regions'}`;
    label.title = id;
    const update = document.createElement('button');
    update.type = 'button';
    update.className = 'small';
    update.textContent = 'Update';
    update.onclick = () => showImport(true);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'small';
    remove.textContent = 'Delete';
    remove.setAttribute('aria-label', `Delete atlas ${id}`);
    remove.dataset.deleteAtlas = id;
    remove.onclick = () => showDeleteAtlas(id);
    const actions = document.createElement('div');
    actions.className = 'atlas-actions';
    actions.append(update, remove);
    row.append(label, actions);
    atlasList.append(row);
  }
  if (!atlasList.children.length) {
    atlasList.textContent = 'No atlases imported yet.';
  }
  palette();
}
function filterPalette() {
  const query = input('search').value.trim().toLowerCase();
  const atlas = select('atlas-filter').value;
  const kind = select('kind-filter').value;
  let count = 0;
  const items = element('palette', HTMLElement).querySelectorAll<HTMLButtonElement>(
    'button[data-asset]',
  );
  for (const item of items) {
    item.hidden = Boolean(
      (query && !item.dataset.asset?.toLowerCase().includes(query)) ||
      (atlas && item.dataset.atlas !== atlas) ||
      (kind && item.dataset.kind !== kind),
    );
    if (!item.hidden) {
      count++;
    }
  }
  element('asset-count', HTMLElement).textContent = `${count} / ${items.length}`;
  element('library-hint', HTMLElement).textContent = !items.length
    ? 'Import an atlas to add tiles and sprites to this project.'
    : !count
      ? 'No matching assets. Clear the search or change the filters.'
      : !loaded
        ? 'Open or create a scene to start using these assets.'
        : 'Choose a tile to paint or a sprite to place. Dimmed tiles need a smaller grid.';
}
function palette() {
  const paletteElement = element('palette', HTMLElement);
  paletteElement.replaceChildren();
  regions.clear();
  sprites.clear();
  brush = null;
  spriteBrush = null;
  if (!project) {
    return;
  }
  const size = loaded?.grid ?? 8;
  for (const [id, atlas] of Object.entries(project.atlases)) {
    const image = images.get(id);
    if (!image) {
      continue;
    }
    for (const region of atlas.regions) {
      const asset = `${id}/${region.name}`;
      const sprite = region.kind === 'sprite';
      const compatible = region.width % size === 0 && region.height % size === 0;
      if (sprite) {
        sprites.set(asset, { image, region });
      }
      const cells: string[][] = [];
      for (let y = 0; !sprite && compatible && y < region.height / size; y++) {
        const row = [];
        for (let x = 0; x < region.width / size; x++) {
          const key = `${id}/${region.name}/${x}/${y}`;
          if (atlas.mappings[String(size)]?.[key] === undefined) {
            throw Error(`Missing atlas cell identity: ${key}`);
          }
          regions.set(key, { image, x: region.x + x * size, y: region.y + y * size });
          row.push(key);
        }
        cells.push(row);
      }
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'asset';
      item.dataset.asset = asset;
      item.dataset.atlas = id;
      item.dataset.kind = region.kind;
      item.disabled = !loaded || (!sprite && !compatible);
      item.draggable = !item.disabled;
      item.ondragstart = (event) => {
        if (busy || !event.dataTransfer) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.setData('application/x-forge-asset', asset);
        event.dataTransfer.effectAllowed = 'copy';
      };
      item.title =
        `${asset} · ${region.kind} · ${region.width} × ${region.height}px` +
        (!sprite && !compatible ? ` · Use a smaller scene grid to paint this tile region.` : '');
      const thumb = document.createElement('canvas');
      thumb.width = region.width;
      thumb.height = region.height;
      const scale = Math.max(
        1,
        Math.min(4, Math.floor(48 / Math.max(region.width, region.height))),
      );
      thumb.style.width = `${region.width * scale}px`;
      thumb.style.height = `${region.height * scale}px`;
      thumb
        .getContext('2d')
        ?.drawImage(
          image,
          region.x,
          region.y,
          region.width,
          region.height,
          0,
          0,
          region.width,
          region.height,
        );
      const label = document.createElement('span');
      label.className = 'asset-name';
      label.textContent = region.name.replaceAll('_', ' ');
      const type = document.createElement('span');
      type.className = 'type';
      type.textContent = `${id} · ${region.kind}`;
      item.append(thumb, label, type);
      item.onclick = () => {
        brush = sprite ? null : cells;
        spriteBrush = sprite ? asset : null;
        paletteElement
          .querySelectorAll('button')
          .forEach((b) => b.setAttribute('aria-pressed', 'false'));
        item.setAttribute('aria-pressed', 'true');
        const paint = document.querySelector<HTMLInputElement>('input[value="paint"]');
        if (paint) {
          paint.checked = true;
        }
        element('paint-label', HTMLElement).textContent = sprite ? 'Place sprite' : 'Paint';
        element('selected-brush', HTMLElement).textContent = `${id} / ${region.name}`;
        element('viewport', HTMLElement).dataset.pan = 'false';
        status.textContent = sprite
          ? `Click the canvas to place ${region.name}. Select to drag it; Delete removes it.`
          : `Paint ${region.name}.`;
        update();
      };
      paletteElement.append(item);
      if (!brush && !spriteBrush && !item.disabled) {
        item.click();
      }
    }
  }
  if (!paletteElement.children.length) {
    const empty = document.createElement('div');
    empty.className = 'library-empty';
    const title = document.createElement('strong');
    title.textContent = 'Your asset library is empty';
    empty.append(
      title,
      document.createTextNode('Import an atlas to see its tiles and sprites here.'),
    );
    paletteElement.append(empty);
  }
  filterPalette();
}
function open(data: Loaded) {
  loaded = data;
  const scene: Scene = {
    version: 1,
    connector: 'forge',
    id: data.id,
    name: data.name,
    profile: 'standalone',
    source_digest: data.revision,
    width: data.width,
    height: data.height,
    cells: data.cells.map((row) => row.map((cell) => cell || 'empty')),
    references: data.objects.map((item) => ({ ...item, id: String(item.id) })),
    next_object_id: data.nextObjectId,
  };
  editor = new Editor(scene, [], { erase_cell: 'empty' });
  baseline = snapshot();
  selection = null;
  selectedSprite = null;
  spriteDrag = null;
  anchor = null;
  hover = null;
  element('coordinates', HTMLElement).textContent = 'Cell —, — · Pixel —, —';
  canvas.hidden = false;
  element('canvas-surround', HTMLElement).hidden = false;
  element('empty-scene', HTMLElement).hidden = true;
  select('scenes').value = data.id;
  element('scene-name', HTMLElement).textContent =
    `${data.name} · ${data.width} × ${data.height} · ${data.grid}px`;
  palette();
  draw();
}
function draw() {
  if (!editor || !loaded) {
    return;
  }
  if (selectedSprite && !editor.scene.references.some((item) => item.id === selectedSprite)) {
    selectedSprite = null;
  }
  const size = loaded.grid;
  canvas.width = loaded.width * size;
  canvas.height = loaded.height * size;
  canvas.style.width = `${canvas.width * Number(select('zoom').value)}px`;
  canvas.style.height = `${canvas.height * Number(select('zoom').value)}px`;
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#242820';
  context.fillRect(0, 0, canvas.width, canvas.height);
  editor.scene.cells.forEach((row, y) =>
    row.forEach((cell, x) => {
      const region = regions.get(cell);
      if (region) {
        context.drawImage(
          region.image,
          region.x,
          region.y,
          size,
          size,
          x * size,
          y * size,
          size,
          size,
        );
      }
    }),
  );
  for (const item of editor.scene.references) {
    const sprite = sprites.get(item.asset);
    if (sprite) {
      const r = sprite.region;
      context.drawImage(
        sprite.image,
        r.x,
        r.y,
        r.width,
        r.height,
        item.x - r.origin[0],
        item.y - r.origin[1],
        r.width,
        r.height,
      );
    }
  }
  if (input('grid').checked) {
    context.strokeStyle = '#0006';
    context.lineWidth = 0.25;
    context.beginPath();
    for (let x = size; x < canvas.width; x += size) {
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
    }
    for (let y = size; y < canvas.height; y += size) {
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
    }
    context.stroke();
  }
  if (selection) {
    context.fillStyle = '#d4b76755';
    context.fillRect(
      selection.x * size,
      selection.y * size,
      selection.w * size,
      selection.h * size,
    );
  }
  const selected = editor.scene.references.find((r) => r.id === selectedSprite);
  const sprite = selected && sprites.get(selected.asset);
  if (selected && sprite) {
    const r = sprite.region;
    context.strokeStyle = '#f2d67b';
    context.lineWidth = 0.75;
    context.strokeRect(selected.x - r.origin[0], selected.y - r.origin[1], r.width, r.height);
    context.fillStyle = '#f2d67b';
    context.fillRect(selected.x - 1, selected.y - 1, 2, 2);
  }
  const tool = document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
  if (hover && tool !== 'pan' && !pan) {
    const width = tool === 'paint' && brush ? brush[0].length : 1;
    const height = tool === 'paint' && brush ? brush.length : 1;
    const valid = hover.x + width <= loaded.width && hover.y + height <= loaded.height;
    context.strokeStyle = valid ? '#f2d67b' : '#ed886f';
    context.lineWidth = 0.5;
    context.strokeRect(
      hover.x * size + 0.25,
      hover.y * size + 0.25,
      width * size - 0.5,
      height * size - 0.5,
    );
  }
  update();
}
function point(event: { clientX: number; clientY: number }) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - rect.left) / rect.width) * (loaded?.width || 1)),
    y: Math.floor(((event.clientY - rect.top) / rect.height) * (loaded?.height || 1)),
    px: Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width),
    py: Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height),
  };
}
function trackHover(event: { clientX: number; clientY: number }) {
  const p = point(event);
  hover = loaded && p.x >= 0 && p.y >= 0 && p.x < loaded.width && p.y < loaded.height ? p : null;
  element('coordinates', HTMLElement).textContent = hover
    ? `Cell ${hover.x}, ${hover.y} · Pixel ${hover.px}, ${hover.py}`
    : 'Cell —, — · Pixel —, —';
}
function hitSprite(px: number, py: number): SceneReference | undefined {
  return editor?.scene.references.findLast((item) => {
    const r = sprites.get(item.asset)?.region;
    return (
      r !== undefined &&
      px >= item.x - r.origin[0] &&
      px < item.x - r.origin[0] + r.width &&
      py >= item.y - r.origin[1] &&
      py < item.y - r.origin[1] + r.height
    );
  });
}
function spritePosition(x: number, y: number, altKey: boolean) {
  const step = input('snap').checked && !altKey && loaded ? loaded.grid : 1;
  const coordinate = (value: number, extent: number) =>
    Math.max(0, Math.min(Math.floor((extent - 1) / step) * step, Math.round(value / step) * step));
  return { x: coordinate(x, canvas.width), y: coordinate(y, canvas.height) };
}
function paint(event: PointerEvent) {
  if (!editor || busy || !anchor) {
    return;
  }
  const p = point(event);
  const tool = document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
  try {
    if (spriteDrag) {
      const drag = spriteDrag;
      const origin = anchor;
      // Selecting an off-grid sprite must not move it before an actual drag.
      if (event.type === 'pointerdown') {
        draw();
        return;
      }
      const position =
        p.px === origin.px && p.py === origin.py
          ? drag
          : spritePosition(drag.x + p.px - origin.px, drag.y + p.py - origin.py, event.altKey);
      editor.change((scene) => {
        const item = scene.references.find((ref) => ref.id === drag.id);
        if (item) {
          item.x = position.x;
          item.y = position.y;
        }
      });
    } else if (tool === 'select') {
      editor.check(p.x, p.y);
      selection = {
        x: Math.min(anchor.x, p.x),
        y: Math.min(anchor.y, p.y),
        w: Math.abs(p.x - anchor.x) + 1,
        h: Math.abs(p.y - anchor.y) + 1,
      };
    } else if (tool === 'erase') {
      const hit = hitSprite(p.px, p.py);
      if (hit) {
        editor.change((scene) => {
          scene.references = scene.references.filter((r) => r.id !== hit.id);
        });
      } else {
        editor.stamp(p.x, p.y, [['empty']]);
      }
    } else if (spriteBrush && tool === 'paint' && event.type === 'pointerdown') {
      const asset = spriteBrush;
      if (p.px < 0 || p.py < 0 || p.px >= canvas.width || p.py >= canvas.height) {
        throw Error('Place the sprite origin inside the scene.');
      }
      const position = spritePosition(p.px, p.py, event.altKey);
      editor.change((scene) => {
        const id = number(scene.next_object_id);
        scene.references.push({ id: String(id), asset, x: position.x, y: position.y });
        scene.next_object_id = id + 1;
        selectedSprite = String(id);
      });
      selection = null;
    } else if (brush && tool === 'paint') {
      editor.stamp(p.x, p.y, brush);
    } else if (brush && tool === 'fill') {
      if (brush.length !== 1 || brush[0].length !== 1) {
        throw Error('Fill needs a one-cell region. Choose a smaller region or another grid size.');
      }
      editor.fill(p.x, p.y, brush[0][0]);
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
  draw();
}
canvas.onpointerdown = (event) => {
  if (!editor || busy || event.button !== 0) {
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  anchor = point(event);
  trackHover(event);
  const tool = document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
  if (tool === 'pan') {
    const viewport = element('viewport', HTMLElement);
    pan = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    viewport.dataset.panning = 'true';
    return;
  }
  editor.begin();
  if (tool === 'select') {
    const hit = hitSprite(anchor.px, anchor.py);
    selectedSprite = hit?.id ?? null;
    selection = null;
    spriteDrag = hit ? { id: hit.id, x: hit.x, y: hit.y } : null;
  }
  paint(event);
};
canvas.onpointermove = (event) => {
  const previous = hover;
  trackHover(event);
  if (pan) {
    const viewport = element('viewport', HTMLElement);
    viewport.scrollLeft = pan.left - event.clientX + pan.x;
    viewport.scrollTop = pan.top - event.clientY + pan.y;
    return;
  }
  if (anchor) {
    paint(event);
  } else if (previous?.x !== hover?.x || previous?.y !== hover?.y) {
    draw();
  }
};
canvas.onpointerleave = () => {
  hover = null;
  element('coordinates', HTMLElement).textContent = 'Cell —, — · Pixel —, —';
  draw();
};
canvas.onpointerup = () => {
  editor?.end();
  anchor = null;
  spriteDrag = null;
  pan = null;
  element('viewport', HTMLElement).dataset.panning = 'false';
  update();
};
canvas.onpointercancel = () => {
  editor?.cancel();
  anchor = null;
  spriteDrag = null;
  pan = null;
  element('viewport', HTMLElement).dataset.panning = 'false';
  draw();
};
canvas.onlostpointercapture = () => {
  editor?.end();
  anchor = null;
  spriteDrag = null;
  pan = null;
  element('viewport', HTMLElement).dataset.panning = 'false';
  update();
};
canvas.ondragover = (event) => {
  if (!busy && editor && event.dataTransfer?.types.includes('application/x-forge-asset')) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }
};
canvas.ondrop = (event) => {
  if (!editor || busy) {
    return;
  }
  const key = event.dataTransfer?.getData('application/x-forge-asset');
  const asset = Array.from(
    element('palette', HTMLElement).querySelectorAll<HTMLButtonElement>('button'),
  ).find((item) => item.dataset.asset === key && !item.disabled);
  if (!asset) {
    return;
  }
  event.preventDefault();
  asset.click();
  canvas.focus({ preventScroll: true });
  anchor = point(event);
  editor.begin();
  paint(
    new PointerEvent('pointerdown', {
      clientX: event.clientX,
      clientY: event.clientY,
      altKey: event.altKey,
    }),
  );
  editor.end();
  anchor = null;
  draw();
};
form('project-form').onsubmit = (event) => {
  event.preventDefault();
  void run(async () => {
    await api('create-project', record, { name: input('project-title').value });
    await refresh();
    status.textContent = 'Project created. Import an atlas and create a scene.';
  });
};
form('import-form').onsubmit = async (event) => {
  event.preventDefault();
  if (!(await discard())) {
    return;
  }
  void run(async () => {
    if (!atlasFolder && !input('atlas-path').value.trim()) {
      throw Error('Choose an atlas folder or enter a manifest path.');
    }
    const report = await api('import-atlas', record, {
      ...(atlasFolder
        ? { bundle: await readBundle(atlasFolder, select('atlas-manifest').value) }
        : { path: input('atlas-path').value }),
      reimport: input('reimport').checked,
      project_revision: revision,
    });
    await refresh();
    if (loaded) {
      open(await api(`scene/${loaded.id}`, decodeLoaded));
    }
    const added = array(report.added, string);
    const changed = array(report.changed, string);
    const lines = [
      `Imported ${string(report.atlas)}.`,
      added.length ? `New regions: ${added.join(', ')}.` : 'No new regions.',
      changed.length ? `Updated regions: ${changed.join(', ')}.` : 'Existing regions preserved.',
    ];
    if (report.artwork_changed === true) {
      lines.push('Artwork updated.');
    }
    if (report.metadata_changed === true) {
      lines.push('Atlas metadata updated.');
    }
    element('import-report', HTMLElement).textContent = lines.join('\n');
    element('import-results', HTMLElement).hidden = false;
    element('import-result-summary', HTMLElement).textContent =
      `Imported ${string(report.atlas)} · ${added.length} new, ${changed.length} updated`;
    element('import-atlas-dialog', HTMLDialogElement).close();
    status.textContent = 'Atlas imported. Stable placements preserved.';
  });
};
form('scene-form').onsubmit = async (event) => {
  event.preventDefault();
  if (!(await discard())) {
    return;
  }
  void run(async () => {
    const data = await api('create-scene', decodeLoaded, {
      name: input('scene-title').value,
      width: Number(input('width').value),
      height: Number(input('height').value),
      grid: Number(select('cell-size').value),
      project_revision: revision,
    });
    await refresh();
    open(data);
    element('create-scene-dialog', HTMLDialogElement).close();
    status.textContent = 'Scene created. Choose a region and paint.';
  });
};
button('open').onclick = async () => {
  const id = select('scenes').value;
  if (!id || !(await discard())) {
    return;
  }
  void run(async () => {
    // Refresh project metadata so externally added scenes/assets can be reopened explicitly.
    const data = await api(`scene/${id}`, decodeLoaded);
    await refresh();
    open(data);
    status.textContent = 'Scene opened.';
  });
};
button('save').onclick = () => {
  if (!editor || !loaded) {
    return;
  }
  const current = loaded;
  const scene = {
    width: loaded.width,
    height: loaded.height,
    grid: loaded.grid,
    cells: editor.scene.cells.map((row) => row.map((cell) => (cell === 'empty' ? '' : cell))),
    objects: editor.scene.references.map((item) => ({ ...item, id: Number(item.id) })),
    next_object_id: number(editor.scene.next_object_id),
  };
  void run(async () => {
    const data = await api('save-scene', decodeLoaded, {
      id: current.id,
      scene,
      revision: current.revision,
      project_revision: revision,
    });
    loaded = data;
    baseline = snapshot();
    // Saving retains editor undo history.
    const catalog = await api('project', record);
    revision = string(catalog.revision);
    status.textContent = 'Scene saved.';
  });
};
button('undo').onclick = () => {
  editor?.undo();
  draw();
};
button('redo').onclick = () => {
  editor?.redo();
  draw();
};
button('revert').onclick = async () => {
  if (loaded && (await discard())) {
    open(loaded);
  }
};
select('zoom').onchange = draw;
input('grid').onchange = draw;
input('snap').onchange = draw;
button('browse-atlas').onclick = () => {
  void run(async () => {
    const browse = button('browse-atlas');
    browse.textContent = 'Choosing…';
    status.textContent = 'Choose the folder containing your atlas.';
    try {
      const selected = await chooseFolder(input('atlas-folder-files'));
      if (!selected) {
        status.textContent = 'Folder selection cancelled.';
        return;
      }
      if (!selected.manifests.length) {
        throw Error('No .atlas.json manifests found. Choose the atlas folder.');
      }
      atlasFolder = selected;
      input('atlas-path').value = '';
      element('atlas-folder-name', HTMLElement).textContent = selected.name;
      const manifests = select('atlas-manifest');
      manifests.replaceChildren(
        ...(selected.manifests.length > 1 ? [new Option('Choose a manifest…', '')] : []),
        ...selected.manifests.map((path) => new Option(path, path)),
      );
      manifests.required = true;
      element('atlas-manifest-field', HTMLElement).hidden = false;
      status.textContent =
        selected.manifests.length === 1
          ? 'Atlas selected. Choose Import atlas to copy it into this project.'
          : 'Folder selected. Choose an atlas manifest to import.';
    } finally {
      browse.textContent = 'Browse folder…';
    }
  });
};
input('atlas-path').oninput = () => {
  atlasFolder = null;
  element('atlas-folder-name', HTMLElement).textContent = 'No folder selected';
  element('atlas-manifest-field', HTMLElement).hidden = true;
  select('atlas-manifest').required = false;
};
button('show-delete').onclick = () => {
  const id = select('scenes').value;
  if (!id || busy) {
    return;
  }
  void run(async () => {
    const scene = loaded?.id === id ? loaded : await api(`scene/${id}`, decodeLoaded);
    deleteCandidate = { id, name: scene.name, revision: scene.revision, projectRevision: revision };
    element('delete-scene-description', HTMLElement).textContent =
      `Delete “${scene.name}” (${scene.width} × ${scene.height} cells, ${scene.grid}px grid)?`;
    element('delete-scene-unsaved', HTMLElement).hidden = loaded?.id !== id || !dirty();
    form('delete-scene-form').querySelector('.form-error')?.replaceChildren();
    element('delete-scene-dialog', HTMLDialogElement).showModal();
  });
};
form('delete-scene-form').onsubmit = (event) => {
  event.preventDefault();
  const candidate = deleteCandidate;
  if (!candidate || busy) {
    return;
  }
  void run(async () => {
    const result = await api('delete-scene', record, {
      id: candidate.id,
      revision: candidate.revision,
      project_revision: candidate.projectRevision,
    });
    if (string(result.deleted) !== candidate.id) {
      throw Error('Unexpected deleted scene response');
    }
    project = decodeProject(result.project);
    revision = string(result.revision);
    if (loaded?.id === candidate.id) {
      loaded = null;
      editor = null;
      baseline = '';
      selection = null;
      selectedSprite = null;
      spriteDrag = null;
      anchor = null;
      hover = null;
      brush = null;
      spriteBrush = null;
      canvas.hidden = true;
      element('canvas-surround', HTMLElement).hidden = true;
      element('empty-scene', HTMLElement).hidden = false;
      element('scene-name', HTMLElement).textContent = 'No scene open';
      element('coordinates', HTMLElement).textContent = 'Cell —, — · Pixel —, —';
      element('selected-brush', HTMLElement).textContent = 'Select a brush';
    }
    element('delete-scene-dialog', HTMLDialogElement).close();
    deleteCandidate = null;
    await refresh();
    if (loaded) {
      select('scenes').value = loaded.id;
      draw();
    }
    status.textContent = `Deleted “${candidate.name}”.`;
  });
};
function showImport(reimport = false) {
  if (busy) {
    return;
  }
  input('reimport').checked = reimport;
  form('import-form').querySelector('.form-error')?.replaceChildren();
  element('import-atlas-dialog', HTMLDialogElement).showModal();
}
function usesAtlas(scene: Scene, id: string) {
  const prefix = id + '/';
  return (
    scene.cells.some((row) => row.some((cell) => cell.startsWith(prefix))) ||
    scene.references.some((ref) => ref.asset.startsWith(prefix))
  );
}
function atlasInHistory(id: string) {
  return Boolean(
    editor && [...editor.undoStack, ...editor.redoStack].some((scene) => usesAtlas(scene, id)),
  );
}
function showDeleteAtlas(id: string) {
  if (busy || !project?.atlases[id]) {
    return;
  }
  deleteAtlasCandidate = { id, projectRevision: revision };
  element('delete-atlas-description', HTMLElement).textContent =
    `Delete “${id}” and its imported assets?`;
  element('delete-atlas-history', HTMLElement).hidden = !atlasInHistory(id);
  const error = form('delete-atlas-form').querySelector('.form-error');
  if (error) {
    error.textContent =
      editor && usesAtlas(editor.scene, id)
        ? 'The open scene uses this atlas. Remove its placements and save before deleting it.'
        : '';
  }
  element('delete-atlas-dialog', HTMLDialogElement).showModal();
  update();
}
form('delete-atlas-form').onsubmit = (event) => {
  event.preventDefault();
  const candidate = deleteAtlasCandidate;
  if (!candidate || busy || (editor && usesAtlas(editor.scene, candidate.id))) {
    return;
  }
  void run(async () => {
    const result = await api('delete-atlas', record, {
      id: candidate.id,
      project_revision: candidate.projectRevision,
      scene: loaded ? { id: loaded.id, revision: loaded.revision } : null,
    });
    if (string(result.deleted) !== candidate.id) {
      throw Error('Unexpected deleted atlas response');
    }
    project = decodeProject(result.project);
    revision = string(result.revision);
    if (loaded) {
      loaded = { ...loaded, revision: string(record(result.scene_revisions)[loaded.id]) };
    }
    if (editor && atlasInHistory(candidate.id)) {
      editor.undoStack = [];
      editor.redoStack = [];
    }
    element('delete-atlas-dialog', HTMLDialogElement).close();
    deleteAtlasCandidate = null;
    await refresh();
    if (loaded && editor) {
      select('scenes').value = loaded.id;
      draw();
    }
    status.textContent = `Deleted atlas “${candidate.id}”.`;
  });
};
function showCreate() {
  if (busy) {
    return;
  }
  form('scene-form').querySelector('.form-error')?.replaceChildren();
  element('create-scene-dialog', HTMLDialogElement).showModal();
}
button('show-create').onclick = showCreate;
button('empty-create').onclick = showCreate;
button('show-import').onclick = () => showImport();
button('library-import').onclick = () => showImport();
for (const close of document.querySelectorAll<HTMLButtonElement>('[data-close]')) {
  close.onclick = () => {
    const id = close.dataset.close;
    if (id) {
      element(id, HTMLDialogElement).close();
    }
  };
}
select('scenes').onchange = update;
input('search').oninput = filterPalette;
select('atlas-filter').onchange = filterPalette;
select('kind-filter').onchange = filterPalette;
button('deselect').onclick = () => {
  selection = null;
  selectedSprite = null;
  draw();
};
button('remove-sprite').onclick = () => {
  const id = selectedSprite;
  editor?.change((scene) => {
    scene.references = scene.references.filter((r) => r.id !== id);
  });
  selectedSprite = null;
  draw();
};
for (const control of document.querySelectorAll<HTMLInputElement>('input[name="tool"]')) {
  control.onchange = () => {
    element('viewport', HTMLElement).dataset.pan = String(control.value === 'pan');
    draw();
  };
}
document.addEventListener('keydown', (event) => {
  if (
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement ||
    document.querySelector('dialog[open]') ||
    busy
  ) {
    return;
  }
  try {
    if ((event.ctrlKey || event.metaKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      button(
        event.key.toLowerCase() === 's'
          ? 'save'
          : event.key.toLowerCase() === 'y' || event.shiftKey
            ? 'redo'
            : 'undo',
      ).click();
    } else if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      editor &&
      ['s', 'p', 'f', 'e', 'h'].includes(event.key.toLowerCase())
    ) {
      const tools: Record<string, string> = {
        s: 'select',
        p: 'paint',
        f: 'fill',
        e: 'erase',
        h: 'pan',
      };
      const control = document.querySelector<HTMLInputElement>(
        `input[name="tool"][value="${tools[event.key.toLowerCase()]}"]`,
      );
      if (control && !control.disabled) {
        event.preventDefault();
        control.checked = true;
        control.dispatchEvent(new Event('change'));
      }
    } else if (selectedSprite && editor) {
      const id = selectedSprite;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        editor.change((scene) => {
          scene.references = scene.references.filter((r) => r.id !== id);
        });
        selectedSprite = null;
      } else if (event.key === 'Escape') {
        selectedSprite = null;
      } else {
        const move: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const delta = move[event.key];
        if (delta) {
          event.preventDefault();
          editor.change((scene) => {
            const item = scene.references.find((r) => r.id === id);
            if (item) {
              item.x = Math.max(0, Math.min(canvas.width - 1, item.x + delta[0]));
              item.y = Math.max(0, Math.min(canvas.height - 1, item.y + delta[1]));
            }
          });
        }
      }
      draw();
    } else if (selection && editor) {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        editor.erase(selection);
      } else {
        const move: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const delta = move[event.key];
        if (delta) {
          event.preventDefault();
          editor.move(selection, ...delta);
          selection.x += delta[0];
          selection.y += delta[1];
        } else if (event.key === 'Escape') {
          selection = null;
        }
      }
      draw();
    }
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});
window.addEventListener('beforeunload', (event) => {
  if (dirty() || busy) {
    event.preventDefault();
    event.returnValue = '';
  }
});
// Import boolean decoding here too: reject malformed preview defaults before first render.
void run(async () => {
  await refresh();
  if (project) {
    const data = await api('project', record);
    const preview = record(record(data.project).preview);
    input('grid').checked = boolean(preview.grid);
    select('zoom').value = String(number(preview.zoom));
  }
  status.textContent = project
    ? 'Choose a scene, or import an atlas and create one.'
    : 'Name your project to get started.';
});
