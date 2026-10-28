/** Standalone project controller for atlas, layer and object authoring. */
import { decodePreviewSettings, prunePreviewSettings } from './preview-settings.mts';
import { sceneOverlaps } from './movement-preview.mts';
import type { PreviewRect } from './movement-preview.mts';
import { createAnimationPreview } from './animation-preview.mts';
import type { SpriteAnimation } from './animation-preview.mts';
import { downloadArchive } from './export.mts';
import { createTileInspector } from './tile-inspector.mts';
import type { TileChoice } from './tile-inspector.mts';
import { decodeMetadataSets, drawCollision, terrainColor } from './tile-metadata.mts';
import type { MetadataSets, TileMetadata } from './tile-metadata.mts';
import { createObjectInspector } from './object-inspector.mts';
import { LayerEditor } from './layers.mts';
import type { LayerScene, SceneLayer } from './layers.mts';
import { decodeObject, encodeObject, objectBounds } from './objects.mts';
import type { SceneObject } from './objects.mts';
import { chooseFolder, readBundle } from './atlas-import.mts';
import type { AtlasFolder } from './atlas-import.mts';
import { array, boolean, number, record, string } from './decode.mts';
import type { Decoder } from './decode.mts';
import type { Selection } from './types.ts';

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
  animations: SpriteAnimation[];
  metadata: MetadataSets;
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
  layers: SceneLayer[];
  nextLayerId: number;
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
const projectMatch = /^\/projects\/([^/]+)\//.exec(location.pathname);
const projectBase = projectMatch ? `/projects/${projectMatch[1]}` : '';
let choosingProject = false;
let hasProjectChoices = false;
let navigating = false;
let pendingProject = '';
let token = '';
let previewSettingsLoaded = false;
let atlasFolder: AtlasFolder | null = null;
let revision = '';
let project: Project | null = null;
let loaded: Loaded | null = null;
let editor: LayerEditor | null = null;
let baseline = '';
let brush: string[][] | null = null;
let spriteBrush: string | null = null;
let objectBrush: 'point' | 'rectangle' | null = null;
let selectedObject: string | null = null;
let objectDrag: { id: string; x: number; y: number } | null = null;
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
const animationPreview = createAnimationPreview(() => draw(false));

function tileMetadata(group: string, asset: string): TileMetadata | undefined {
  return project?.atlases[asset.split('/')[0]]?.metadata[group]?.[asset];
}
const tileInspector = createTileInspector(
  (tile) => tileMetadata(tile.group, tile.asset),
  async (tile, metadata) => {
    if (busy) {
      throw Error('Finish the current operation before saving tile metadata.');
    }
    busy = true;
    update();
    try {
      const result = await api('save-tile-metadata', record, {
        atlas: tile.atlas,
        group: tile.group,
        asset: tile.asset,
        metadata,
        project_revision: revision,
      });
      project = decodeProject(result.project);
      revision = string(result.revision);
      draw();
      status.textContent =
        'Tile metadata saved. Shared instances use the new terrain and collision.';
    } finally {
      busy = false;
      update();
    }
  },
);
button('edit-tile').onclick = () => {
  if (!loaded || busy) {
    return;
  }
  const choices: TileChoice[] = [];
  if (spriteBrush) {
    const sprite = sprites.get(spriteBrush);
    if (sprite) {
      choices.push({
        atlas: spriteBrush.split('/')[0],
        group: 'sprites',
        asset: spriteBrush,
        image: sprite.image,
        sx: sprite.region.x,
        sy: sprite.region.y,
        width: sprite.region.width,
        height: sprite.region.height,
      });
    }
  } else if (brush) {
    for (const asset of brush.flat()) {
      const region = regions.get(asset);
      if (region) {
        choices.push({
          atlas: asset.split('/')[0],
          group: String(loaded.grid),
          asset,
          image: region.image,
          sx: region.x,
          sy: region.y,
          width: loaded.grid,
          height: loaded.grid,
        });
      }
    }
  }
  tileInspector.open(choices);
};
const objectInspector = createObjectInspector(() => {
  const item = editor?.objects.find((item) => item.id === selectedObject);
  return editor && item ? { editor, item } : null;
}, draw);
button('edit-object').onclick = objectInspector.open;
for (const kind of ['point', 'rectangle'] as const) {
  button(`place-${kind}`).onclick = () => {
    if (!editor || busy) {
      return;
    }
    const layer =
      editor.active.type === 'objectgroup'
        ? editor.active
        : editor.layers.find((layer) => layer.visible && layer.type === 'objectgroup');
    if (!layer) {
      status.textContent = 'Add an object layer before placing objects.';
      return;
    }
    layerAction((editor) => editor.activate(layer.id));
    objectBrush = kind;
    brush = null;
    spriteBrush = null;
    element('palette', HTMLElement)
      .querySelectorAll('button')
      .forEach((button) => button.setAttribute('aria-pressed', 'false'));
    const paintTool = document.querySelector<HTMLInputElement>('input[value="paint"]');
    if (paintTool) {
      paintTool.checked = true;
    }
    element('viewport', HTMLElement).dataset.pan = 'false';
    element('paint-label', HTMLElement).textContent = 'Place object';
    element('selected-brush', HTMLElement).textContent =
      kind === 'point' ? 'Spawn point' : 'Trigger area';
    status.textContent =
      'Click to place an object. Select it to edit its name, class, dimensions and properties.';
    draw();
  };
}
select('object-list').onchange = () => {
  selectedObject = select('object-list').value || null;
  selection = null;
  const control = document.querySelector<HTMLInputElement>('input[value="select"]');
  if (control) {
    control.checked = true;
  }
  draw();
};
async function request(
  route: string,
  data?: unknown,
  timeout = 30000,
  base = projectBase,
): Promise<Response> {
  const response = await fetch(`${base}/api/${route}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers:
      data === undefined ? {} : { 'Content-Type': 'application/json', 'X-Scene-Token': token },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) {
    const body: unknown = await response.json();
    throw Error(string(record(body).error));
  }
  return response;
}
async function api<T>(route: string, decode: Decoder<T>, data?: unknown): Promise<T> {
  return decode(await (await request(route, data)).json());
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
    layers:
      scene.layers === undefined
        ? [
            {
              id: 1,
              name: 'Ground',
              type: 'tilelayer' as const,
              visible: true,
              cells: array(scene.cells, (row) => array(row, string)).map((row) =>
                row.map((cell) => cell || 'empty'),
              ),
            },
            {
              id: 2,
              name: 'Sprites',
              type: 'objectgroup' as const,
              visible: true,
              objects: array(scene.objects ?? [], decodeObject),
            },
          ]
        : array(scene.layers, (value): SceneLayer => {
            const layer = record(value);
            const common = {
              id: number(layer.id),
              name: string(layer.name),
              visible: boolean(layer.visible),
            };
            if (layer.type === 'tilelayer') {
              return {
                ...common,
                type: 'tilelayer',
                cells: array(layer.cells, (row) => array(row, string)).map((row) =>
                  row.map((cell) => cell || 'empty'),
                ),
              };
            }
            if (layer.type !== 'objectgroup') {
              throw Error('Unsupported layer type');
            }
            return {
              ...common,
              type: 'objectgroup',
              objects: array(layer.objects, decodeObject),
            };
          }),
    nextLayerId: number(scene.next_layer_id ?? 3),
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
    !result.layers.length ||
    result.layers.some(
      (layer) =>
        layer.type === 'tilelayer' &&
        (layer.cells.length !== result.height ||
          layer.cells.some((row) => row.length !== result.width)),
    )
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
      metadata: decodeMetadataSets(entry.metadata),
      mappings,
      animations: array(record(entry.manifest).animations ?? [], (value) => {
        const animation = record(value);
        return {
          name: string(animation.name),
          frames: array(animation.frames, (value) => {
            const frame = record(value);
            const region = array(record(entry.manifest).regions, record).find(
              (region) => region.name === frame.region,
            );
            return {
              region: string(frame.region),
              duration: number(frame.duration_ms ?? region?.duration_ms),
            };
          }),
        };
      }),
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
        layers: editor.layers,
        nextLayer: editor.scene.next_layer_id,
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
  select('switch-project').disabled = busy || anchor !== null || !projectBase;
  button('show-new-project').disabled = button('back-to-projects').disabled = busy;
  for (const id of ['switch-save', 'switch-discard', 'switch-cancel']) {
    button(id).disabled = busy;
  }
  element('dirty', HTMLElement).textContent = !editor ? 'NO SCENE' : dirty() ? 'UNSAVED' : 'SAVED';
  element('dirty', HTMLElement).dataset.dirty = String(dirty());
  button('save-preview-settings').disabled = busy || !project;
  button('save').disabled = busy || !editor || !dirty();
  button('show-export').disabled = busy || !project || anchor !== null;
  button('export-confirm').disabled = button('export-cancel').disabled = busy;
  select('export-scope').disabled = busy;
  input('export-canvas').disabled = busy || !editor || !dirty();
  button('undo').disabled = busy || !editor?.undoStack.length;
  button('redo').disabled = busy || !editor?.redoStack.length;
  button('revert').disabled = busy || !dirty();
  button('deselect').disabled = busy || (!selection && !selectedObject);
  button('edit-tile').disabled = busy || !loaded || (!brush && !spriteBrush) || anchor !== null;
  button('edit-object').disabled =
    busy ||
    !editor ||
    !selectedObject ||
    !editor.objects.some((item) => item.id === selectedObject);
  for (const kind of ['point', 'rectangle']) {
    button(`place-${kind}`).setAttribute('aria-pressed', String(objectBrush === kind));
  }
  button('place-point').disabled = button('place-rectangle').disabled =
    busy || !editor || anchor !== null;
  button('remove-sprite').disabled =
    busy || !selectedObject || !editor?.objects.some((r) => r.id === selectedObject);
  for (const id of ['paint', 'erase', 'fill', 'select', 'pan']) {
    const control = document.querySelector<HTMLInputElement>(`input[value="${id}"]`);
    if (control) {
      control.disabled =
        busy ||
        !editor ||
        (id === 'fill' &&
          (spriteBrush !== null || objectBrush !== null || editor?.active.type !== 'tilelayer'));
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
  renderLayers();
  inspect();
}
function renderLayers() {
  const list = select('layers');
  list.replaceChildren(
    ...(editor
      ? [...editor.layers]
          .reverse()
          .map(
            (layer) =>
              new Option(
                `${layer.visible ? '●' : '○'} ${layer.name} · ${layer.type === 'tilelayer' ? 'Tiles' : 'Objects'}`,
                String(layer.id),
                false,
                layer.id === editor?.active.id,
              ),
          )
      : []),
  );
  const disabled = busy || !editor || anchor !== null;
  list.disabled = disabled;
  input('layer-name').disabled = disabled;
  if (document.activeElement !== input('layer-name')) {
    input('layer-name').value = editor?.active.name || '';
  }
  for (const id of [
    'layer-up',
    'layer-down',
    'layer-visible',
    'layer-remove',
    'layer-tile',
    'layer-object',
  ]) {
    button(id).disabled = disabled;
  }
  if (editor) {
    const index = editor.layers.indexOf(editor.active);
    button('layer-up').disabled ||= index === editor.layers.length - 1;
    button('layer-down').disabled ||= index === 0;
    button('layer-remove').disabled ||= editor.layers.length === 1;
    button('layer-visible').textContent = editor.active.visible ? 'Hide' : 'Show';
  }
}
function layerAction(work: (editor: LayerEditor) => void) {
  if (!editor || busy || anchor) {
    return;
  }
  try {
    work(editor);
    selection = null;
    selectedObject = null;
    objectDrag = null;
    input('layer-name').value = editor.active.name;
    draw();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
select('layers').onchange = () =>
  layerAction((editor) => editor.activate(Number(select('layers').value)));
input('layer-name').onchange = () =>
  layerAction((editor) => editor.rename(input('layer-name').value));
button('layer-tile').onclick = () => layerAction((editor) => editor.add('tilelayer'));
button('layer-object').onclick = () => layerAction((editor) => editor.add('objectgroup'));
button('layer-up').onclick = () => layerAction((editor) => editor.reorder(1));
button('layer-down').onclick = () => layerAction((editor) => editor.reorder(-1));
button('layer-visible').onclick = () => layerAction((editor) => editor.visibility());
button('layer-remove').onclick = () => layerAction((editor) => editor.remove());
function inspect() {
  input('inspector-name').value = loaded?.name || '';
  input('inspector-size').value = loaded ? `${loaded.width} × ${loaded.height} cells` : '';
  input('inspector-grid').value = loaded ? `${loaded.grid} px` : '';
  const objectCount =
    editor?.layers.reduce(
      (count, layer) => count + (layer.type === 'objectgroup' ? layer.objects.length : 0),
      0,
    ) || 0;
  element('scene-summary', HTMLElement).textContent =
    loaded && editor
      ? `${loaded.width * loaded.grid} × ${loaded.height * loaded.grid} pixels · ${objectCount} ${objectCount === 1 ? 'object' : 'objects'}`
      : 'Open a scene to inspect its dimensions and placed sprites.';
  const item = editor?.objects.find((r) => r.id === selectedObject);
  select('object-list').replaceChildren(
    ...(editor?.objects.map(
      (item) =>
        new Option(
          `${item.name || item.class || item.kind} · #${item.id}`,
          item.id,
          false,
          item.id === selectedObject,
        ),
    ) || []),
  );
  select('object-list').disabled = busy || !editor?.objects.length || anchor !== null;
  const sprite = item?.kind === 'sprite' && sprites.get(item.asset);
  const atlas = item?.kind === 'sprite' ? project?.atlases[item.asset.split('/')[0]] : undefined;
  animationPreview.configure(
    item?.kind === 'sprite' && sprite && atlas
      ? {
          key: item.id + ':' + item.asset,
          asset: item.asset,
          image: sprite.image,
          region: sprite.region,
          regions: atlas.regions,
          animations: atlas.animations.filter((animation) =>
            animation.frames.every((frame) =>
              atlas.regions.some(
                (region) => region.name === frame.region && region.kind === 'sprite',
              ),
            ),
          ),
          origin: item.origin,
          start: { x: item.x, y: item.y },
          world: {
            width: canvas.width,
            height: canvas.height,
            blocked: (rect) => previewBlocked(rect, item.id),
          },
        }
      : null,
  );
  element('selection-preview', HTMLElement).hidden = !sprite;
  if (item?.kind === 'sprite' && sprite) {
    const r = sprite.region;
    element('selection-kind', HTMLElement).textContent = 'SPRITE';
    element('selection-name', HTMLElement).textContent =
      item.name || item.asset.replace('/', ' / ');
    element('selection-detail', HTMLElement).textContent =
      `${r.width} × ${r.height}px · X ${item.x}, Y ${item.y} · Origin ${(item.origin || r.origin)[0]}, ${(item.origin || r.origin)[1]} · #${item.id}`;
  } else if (item) {
    element('selection-kind', HTMLElement).textContent = item.kind.toUpperCase();
    element('selection-name', HTMLElement).textContent = item.name || item.class || item.kind;
    element('selection-detail', HTMLElement).textContent =
      `#${item.id} · ${item.class || 'No class'} · X ${item.x}, Y ${item.y}${item.kind === 'rectangle' ? ` · ${item.width} × ${item.height}px` : ''} · ${item.properties.length} properties`;
  } else if (selection) {
    element('selection-kind', HTMLElement).textContent = 'TILES';
    element('selection-name', HTMLElement).textContent = `${selection.w} × ${selection.h} cells`;
    element('selection-detail', HTMLElement).textContent =
      `Column ${selection.x}, row ${selection.y}. Arrow keys move the selection; Delete erases it.`;
  } else {
    element('selection-kind', HTMLElement).textContent = '—';
    element('selection-name', HTMLElement).textContent = 'Nothing selected';
    element('selection-detail', HTMLElement).textContent =
      'Select an object on the canvas or in the list to edit it, or select tiles on a tile layer.';
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
function showProjectStart(creating: boolean) {
  element('project-picker', HTMLElement).hidden = project !== null || creating;
  form('project-form').hidden = project !== null || !creating;
  button('back-to-projects').hidden = !hasProjectChoices;
}
button('show-new-project').onclick = () => {
  showProjectStart(true);
  input('project-title').focus();
};
button('back-to-projects').onclick = () => {
  showProjectStart(false);
  button('show-new-project').focus();
};
async function refresh() {
  const data = await api('project', record);
  token = string(data.token);
  choosingProject = Array.isArray(data.projects);
  if (choosingProject) {
    const list = element('project-list', HTMLElement);
    list.replaceChildren();
    for (const value of array(data.projects, record)) {
      const link = document.createElement('a');
      link.className = 'project-card';
      link.href = `/projects/${encodeURIComponent(string(value.directory))}/`;
      const title = document.createElement('strong');
      title.textContent = string(value.name);
      link.title = string(value.directory);
      link.append(title);
      list.append(link);
    }
    const unavailable = element('unavailable-projects', HTMLElement);
    unavailable.replaceChildren();
    for (const value of array(data.unavailable, record)) {
      const message = document.createElement('p');
      message.textContent = `${string(value.directory)}: ${string(value.error)}`;
      unavailable.append(message);
    }
    hasProjectChoices = list.children.length > 0 || unavailable.children.length > 0;
  }
  if (!previewSettingsLoaded && data.project !== null) {
    const saved = record(record(data.project).preview).sprite;
    if (saved !== undefined) {
      animationPreview.restore(decodePreviewSettings(saved));
    }
    previewSettingsLoaded = true;
  }
  project = data.project === null ? null : decodeProject(data.project);
  const projects = select('switch-project');
  projects.replaceChildren(new Option(project?.name || 'Current project', projectBase));
  if (projectBase) {
    const catalog = record(await (await request('project', undefined, 30000, '')).json());
    projects.replaceChildren(
      ...array(catalog.projects, record).map(
        (item) =>
          new Option(string(item.name), `/projects/${encodeURIComponent(string(item.directory))}`),
      ),
      new Option('Choose or create project…', '/'),
    );
  }
  projects.value = projectBase;
  revision = data.project === null ? '' : string(data.revision);
  showProjectStart(!hasProjectChoices);
  element('project-start', HTMLElement).hidden = project !== null;
  element('workspace', HTMLElement).hidden = project === null;
  if (!project && !hasProjectChoices) {
    input('project-title').focus();
  }
  element('project-name', HTMLElement).textContent =
    project?.name || (choosingProject ? 'Your projects' : 'Create a project');
  document.title = `${project?.name || (choosingProject ? 'Projects' : 'New project')} · Scene Forge`;
  const previous = select('scenes').value;
  select('scenes').replaceChildren(
    new Option('Choose a scene…', ''),
    ...(project?.scenes.map((s) => new Option(s.name, s.id)) || []),
  );
  select('scenes').value = project?.scenes.some((item) => item.id === previous) ? previous : '';
  images.clear();
  for (const [id, atlas] of Object.entries(project?.atlases || {})) {
    const image = new Image();
    image.src = `${projectBase}/${atlas.png}?revision=${encodeURIComponent(revision)}`;
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
  objectBrush = null;
  if (!project) {
    return;
  }
  const size = loaded?.grid ?? 8;
  let initialBrush: HTMLButtonElement | null = null;
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
        if (editor && editor.active.type !== (sprite ? 'objectgroup' : 'tilelayer')) {
          const layer = editor.layers.find(
            (layer) => layer.visible && layer.type === (sprite ? 'objectgroup' : 'tilelayer'),
          );
          if (layer) {
            editor.activate(layer.id);
            selection = null;
            selectedObject = null;
          }
        }
        objectBrush = null;
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
        draw();
      };
      paletteElement.append(item);
      if (!initialBrush && !item.disabled) {
        initialBrush = item;
      }
    }
  }
  initialBrush?.click();
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
  const scene: LayerScene = {
    width: data.width,
    height: data.height,
    layers: data.layers,
    next_layer_id: data.nextLayerId,
    active_layer_id: data.layers[0].id,
    next_object_id: data.nextObjectId,
    grid: data.grid,
  };
  animationPreview.reset();
  editor = new LayerEditor(scene, [], { erase_cell: 'empty' });
  editor.spriteRegion = (asset) => sprites.get(asset)?.region;
  baseline = snapshot();
  selection = null;
  selectedObject = null;
  objectDrag = null;
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
function previewBlocked(rect: PreviewRect, selectedId: string): boolean {
  if (!editor || !loaded) {
    return false;
  }
  return sceneOverlaps(rect, editor.layers, loaded.grid, selectedId, tileMetadata, bounds);
}

function draw(refreshUI = true) {
  if (!editor || !loaded) {
    return;
  }
  if (selectedObject && !editor.objects.some((item) => item.id === selectedObject)) {
    selectedObject = null;
  }
  const size = loaded.grid;
  canvas.width = loaded.width * size;
  canvas.height = loaded.height * size;
  canvas.style.width = `${canvas.width * Number(select('zoom').value)}px`;
  canvas.style.height = `${canvas.height * Number(select('zoom').value)}px`;
  if (refreshUI) {
    update();
  }
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#242820';
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const layer of editor.layers) {
    if (!layer.visible) {
      continue;
    }
    if (layer.type === 'tilelayer') {
      layer.cells.forEach((row, y) =>
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
    }
    if (layer.type === 'objectgroup') {
      for (const item of layer.objects) {
        const sprite = item.kind === 'sprite' && sprites.get(item.asset);
        if (sprite) {
          const r =
            item.id === selectedObject
              ? animationPreview.frame(
                  item.id + ':' + (item.kind === 'sprite' ? item.asset : ''),
                ) || sprite.region
              : sprite.region;
          const position =
            animationPreview.movement.position(
              item.id + ':' + (item.kind === 'sprite' ? item.asset : ''),
            ) || item;
          const pivot = item.kind === 'sprite' ? item.origin || r.origin : r.origin;
          context.drawImage(
            sprite.image,
            r.x,
            r.y,
            r.width,
            r.height,
            position.x - pivot[0],
            position.y - pivot[1],
            r.width,
            r.height,
          );
        } else {
          const r = bounds(item);
          context.strokeStyle = '#83cfc1';
          context.fillStyle = '#83cfc133';
          context.lineWidth = 0.75;
          if (item.kind === 'point') {
            context.beginPath();
            context.arc(item.x, item.y, 3, 0, Math.PI * 2);
            context.stroke();
            context.beginPath();
            context.moveTo(item.x - 4, item.y);
            context.lineTo(item.x + 4, item.y);
            context.moveTo(item.x, item.y - 4);
            context.lineTo(item.x, item.y + 4);
            context.stroke();
          } else {
            context.fillRect(r.x, r.y, r.width, r.height);
            context.strokeRect(r.x + 0.25, r.y + 0.25, r.width - 0.5, r.height - 0.5);
          }
        }
      }
    }
  }
  if (input('terrain-overlay').checked || input('collision-overlay').checked) {
    const overlay = (
      group: string,
      asset: string,
      x: number,
      y: number,
      width: number,
      height: number,
    ) => {
      const value = tileMetadata(group, asset);
      if (!value) {
        return;
      }
      context.save();
      context.translate(x, y);
      if (input('terrain-overlay').checked && value.terrain) {
        context.fillStyle = terrainColor(value.terrain);
        context.fillRect(0, 0, width, height);
      }
      if (input('collision-overlay').checked) {
        drawCollision(context, value, width, height);
      }
      context.restore();
    };
    for (const layer of editor.layers) {
      if (!layer.visible) {
        continue;
      }
      if (layer.type === 'tilelayer') {
        layer.cells.forEach((row, y) =>
          row.forEach((cell, x) => overlay(String(size), cell, x * size, y * size, size, size)),
        );
      } else {
        for (const item of layer.objects) {
          if (item.kind !== 'sprite') {
            continue;
          }
          const r = bounds(item);
          overlay('sprites', item.asset, r.x, r.y, r.width, r.height);
        }
      }
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
  const selected = editor.objects.find((r) => r.id === selectedObject);
  if (selected) {
    const r = bounds(selected);
    context.strokeStyle = '#f2d67b';
    context.lineWidth = 0.75;
    context.strokeRect(r.x, r.y, r.width, r.height);
    context.fillStyle = '#f2d67b';
    context.fillRect(selected.x - 1, selected.y - 1, 2, 2);
    if (selected.kind === 'sprite') {
      animationPreview.movement.draw(context, selected.id + ':' + selected.asset);
    }
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
function bounds(item: SceneObject) {
  return objectBounds(item, item.kind === 'sprite' ? sprites.get(item.asset)?.region : undefined);
}
function hitObject(px: number, py: number): SceneObject | undefined {
  return editor?.objects.findLast((item) => {
    const r = bounds(item);
    return px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height;
  });
}
function spritePosition(x: number, y: number, altKey: boolean, item?: SceneObject) {
  const step = input('snap').checked && !altKey && loaded ? loaded.grid : 1;
  const coordinate = (value: number, extent: number) =>
    Math.max(0, Math.min(Math.floor((extent - 1) / step) * step, Math.round(value / step) * step));
  return {
    x: coordinate(x, canvas.width - (item?.kind === 'rectangle' ? item.width - 1 : 0)),
    y: coordinate(y, canvas.height - (item?.kind === 'rectangle' ? item.height - 1 : 0)),
  };
}
function paint(event: PointerEvent) {
  if (!editor || busy || !anchor) {
    return;
  }
  const p = point(event);
  const tool = document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
  try {
    editor.editable();
    if (objectDrag) {
      const drag = objectDrag;
      const origin = anchor;
      // Selecting an off-grid sprite must not move it before an actual drag.
      if (event.type === 'pointerdown') {
        draw();
        return;
      }
      const position =
        p.px === origin.px && p.py === origin.py
          ? drag
          : spritePosition(
              drag.x + p.px - origin.px,
              drag.y + p.py - origin.py,
              event.altKey,
              editor.objects.find((item) => item.id === drag.id),
            );
      editor.change(() => {
        editor?.editable('objectgroup');
        const item = editor?.objects.find((ref) => ref.id === drag.id);
        if (item) {
          item.x = position.x;
          item.y = position.y;
        }
      });
    } else if (tool === 'select') {
      if (editor.active.type !== 'tilelayer') {
        return;
      }
      editor.check(p.x, p.y);
      selection = {
        x: Math.min(anchor.x, p.x),
        y: Math.min(anchor.y, p.y),
        w: Math.abs(p.x - anchor.x) + 1,
        h: Math.abs(p.y - anchor.y) + 1,
      };
    } else if (tool === 'erase') {
      const hit = hitObject(p.px, p.py);
      if (hit) {
        editor.change(() => {
          if (editor) {
            editor.objects = editor.objects.filter((r) => r.id !== hit.id);
          }
        });
      } else if (editor.active.type === 'tilelayer') {
        editor.stamp(p.x, p.y, [['empty']]);
      }
    } else if (objectBrush && tool === 'paint' && event.type === 'pointerdown') {
      if (p.px < 0 || p.py < 0 || p.px >= canvas.width || p.py >= canvas.height) {
        throw Error('Place the object inside the scene.');
      }
      const position = spritePosition(p.px, p.py, event.altKey);
      const common = { x: position.x, y: position.y, name: '', properties: [] };
      selectedObject = editor.createObject(
        objectBrush === 'point'
          ? { ...common, kind: 'point', class: 'spawn' }
          : {
              ...common,
              kind: 'rectangle',
              class: 'trigger',
              width: Math.min(loaded?.grid || 8, canvas.width - position.x),
              height: Math.min(loaded?.grid || 8, canvas.height - position.y),
            },
      );
      selection = null;
    } else if (spriteBrush && tool === 'paint' && event.type === 'pointerdown') {
      editor.editable('objectgroup');
      const asset = spriteBrush;
      if (p.px < 0 || p.py < 0 || p.px >= canvas.width || p.py >= canvas.height) {
        throw Error('Place the sprite origin inside the scene.');
      }
      const position = spritePosition(p.px, p.py, event.altKey);
      selectedObject = editor.createObject({
        kind: 'sprite',
        asset,
        x: position.x,
        y: position.y,
        name: '',
        class: '',
        properties: [],
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
    const hit = hitObject(anchor.px, anchor.py);
    selectedObject = hit?.id ?? null;
    selection = null;
    objectDrag = hit ? { id: hit.id, x: hit.x, y: hit.y } : null;
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
  objectDrag = null;
  pan = null;
  element('viewport', HTMLElement).dataset.panning = 'false';
  update();
};
canvas.onpointercancel = () => {
  editor?.cancel();
  anchor = null;
  objectDrag = null;
  pan = null;
  element('viewport', HTMLElement).dataset.panning = 'false';
  draw();
};
canvas.onlostpointercapture = () => {
  editor?.end();
  anchor = null;
  objectDrag = null;
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
  if (animationPreview.movement.active) {
    event.preventDefault();
    return;
  }
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
    const result = await api('create-project', record, { name: input('project-title').value });
    if (choosingProject) {
      navigating = true;
      location.assign(`/projects/${encodeURIComponent(string(result.directory))}/`);
      return;
    }
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
function sceneSnapshot() {
  if (!editor || !loaded) {
    throw Error('Open a scene first.');
  }
  return {
    width: loaded.width,
    height: loaded.height,
    grid: loaded.grid,
    layers: editor.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      visible: layer.visible,
      ...(layer.type === 'tilelayer'
        ? { cells: layer.cells.map((row) => row.map((cell) => (cell === 'empty' ? '' : cell))) }
        : { objects: layer.objects.map(encodeObject) }),
    })),
    next_layer_id: number(editor.scene.next_layer_id),
    next_object_id: number(editor.scene.next_object_id),
  };
}
button('save-preview-settings').onclick = () => {
  if (!project || busy) {
    return;
  }
  void run(async () => {
    const available: Record<string, string[]> = {};
    for (const [atlasId, atlas] of Object.entries(project?.atlases || {})) {
      const spriteNames = new Set(
        atlas.regions.filter((region) => region.kind === 'sprite').map((region) => region.name),
      );
      const animations = atlas.animations
        .filter((animation) => animation.frames.every((frame) => spriteNames.has(frame.region)))
        .map((animation) => animation.name);
      for (const name of spriteNames) {
        available[`${atlasId}/${name}`] = animations;
      }
    }
    const result = await api('save-preview-settings', record, {
      settings: prunePreviewSettings(animationPreview.settings(), available),
      project_revision: revision,
    });
    project = decodeProject(result.project);
    revision = string(result.revision);
    status.textContent =
      'Preview settings saved. Scene edits and starting positions are unchanged.';
  });
};
async function saveScene() {
  if (!editor || !loaded) {
    return;
  }
  const data = await api('save-scene', decodeLoaded, {
    id: loaded.id,
    scene: sceneSnapshot(),
    revision: loaded.revision,
    project_revision: revision,
  });
  loaded = data;
  baseline = snapshot();
  const catalog = await api('project', record);
  revision = string(catalog.revision);
  status.textContent = 'Scene saved.';
}
button('save').onclick = () => void run(saveScene);
function navigateProject() {
  navigating = true;
  location.assign(pendingProject === '/' ? '/' : `${pendingProject}/`);
}
select('switch-project').onchange = () => {
  const destination = select('switch-project').value;
  select('switch-project').value = projectBase;
  if (busy || anchor || !destination || destination === projectBase) {
    return;
  }
  pendingProject = destination;
  element('switch-project-dialog', HTMLDialogElement)
    .querySelector('.form-error')
    ?.replaceChildren();
  if (dirty()) {
    element('switch-project-dialog', HTMLDialogElement).showModal();
  } else {
    navigateProject();
  }
};
button('switch-save').onclick = () => {
  void run(async () => {
    await saveScene();
    navigateProject();
  });
};
button('switch-discard').onclick = () => {
  if (!busy) {
    navigateProject();
  }
};
button('switch-cancel').onclick = () => {
  if (!busy) {
    element('switch-project-dialog', HTMLDialogElement).close();
  }
};
element('switch-project-dialog', HTMLDialogElement).oncancel = (event) => {
  if (busy) {
    event.preventDefault();
  }
};

function exportDetails() {
  const projectScope = select('export-scope').value === 'project';
  element('export-details', HTMLElement).textContent = projectScope
    ? `Export all ${project?.scenes.length || 0} saved scene(s) and managed assets. The ZIP can be reopened in Forge or Tiled.`
    : `Export “${loaded?.name || ''}” and all referenced tilesets and PNGs for Tiled.`;
  element('export-canvas-field', HTMLElement).hidden = !editor || !dirty();
}
button('show-export').onclick = () => {
  if (!project || busy || anchor) {
    return;
  }
  select('export-scope').replaceChildren(
    ...(loaded ? [new Option('Open scene', 'scene')] : []),
    new Option('Whole project', 'project'),
  );
  input('export-canvas').checked = !!editor && dirty();
  exportDetails();
  element('export-form', HTMLFormElement).querySelector('.form-error')?.replaceChildren();
  element('export-dialog', HTMLDialogElement).showModal();
};
select('export-scope').onchange = exportDetails;
button('export-cancel').onclick = () => {
  if (!busy) {
    element('export-dialog', HTMLDialogElement).close();
  }
};
element('export-dialog', HTMLDialogElement).oncancel = (event) => {
  if (busy) {
    event.preventDefault();
  }
};
form('export-form').onsubmit = (event) => {
  event.preventDefault();
  if (!project || busy) {
    return;
  }
  const scope = select('export-scope').value;
  const includeCanvas = !!editor && dirty() && input('export-canvas').checked;
  const payload = {
    scope,
    project_revision: revision,
    ...(loaded && (scope === 'scene' || includeCanvas)
      ? { scene_id: loaded.id, scene_revision: loaded.revision }
      : {}),
    ...(includeCanvas ? { scene: sceneSnapshot() } : {}),
  };
  void run(async () => {
    status.textContent = 'Preparing portable export…';
    await downloadArchive(await request('export', payload, 120000));
    element('export-dialog', HTMLDialogElement).close();
    status.textContent = includeCanvas
      ? 'Export downloaded with open scene edits. Those edits are still unsaved in this project.'
      : 'Portable export downloaded.';
  });
};
button('undo').onclick = () => {
  selection = null;
  editor?.undo();
  draw();
};
button('redo').onclick = () => {
  selection = null;
  editor?.redo();
  draw();
};
button('revert').onclick = async () => {
  if (loaded && (await discard())) {
    open(loaded);
  }
};
select('zoom').onchange = () => draw();
input('grid').onchange = () => draw();
input('terrain-overlay').onchange = () => draw();
input('collision-overlay').onchange = () => draw();
input('snap').onchange = () => draw();
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
      selectedObject = null;
      objectDrag = null;
      anchor = null;
      hover = null;
      brush = null;
      spriteBrush = null;
      objectBrush = null;
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
function usesAtlas(scene: LayerScene, id: string) {
  const prefix = id + '/';
  return (scene.layers || []).some((layer) =>
    layer.type === 'tilelayer'
      ? layer.cells.some((row) => row.some((cell) => cell.startsWith(prefix)))
      : layer.objects.some((item) => item.kind === 'sprite' && item.asset.startsWith(prefix)),
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
  selectedObject = null;
  draw();
};
button('remove-sprite').onclick = () => {
  const id = selectedObject;
  editor?.change(() => {
    if (editor) {
      editor.objects = editor.objects.filter((r) => r.id !== id);
    }
  });
  selectedObject = null;
  draw();
};
for (const control of document.querySelectorAll<HTMLInputElement>('input[name="tool"]')) {
  control.onchange = () => {
    element('viewport', HTMLElement).dataset.pan = String(control.value === 'pan');
    draw();
  };
}
// Active preview captures scene gestures so they cannot become authoring strokes.
for (const type of ['pointerdown', 'pointermove', 'pointerup', 'dblclick']) {
  canvas.addEventListener(
    type,
    (event) => {
      if (!animationPreview.movement.active) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      if (type === 'pointerdown') {
        canvas.focus({ preventScroll: true });
      }
    },
    { capture: true },
  );
}
document.addEventListener('keydown', (event) => {
  if (!busy && animationPreview.movement.keydown(event)) {
    return;
  }
  if (
    (event.target instanceof Element && event.target.closest('#animation-preview')) ||
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
    } else if (selectedObject && editor) {
      const id = selectedObject;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        editor.change(() => {
          if (editor) {
            editor.objects = editor.objects.filter((r) => r.id !== id);
          }
        });
        selectedObject = null;
      } else if (event.key === 'Escape') {
        selectedObject = null;
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
          editor.change(() => {
            const item = editor?.objects.find((r) => r.id === id);
            if (item) {
              item.x = Math.max(
                0,
                Math.min(
                  canvas.width - (item.kind === 'rectangle' ? item.width : 1),
                  item.x + delta[0],
                ),
              );
              item.y = Math.max(
                0,
                Math.min(
                  canvas.height - (item.kind === 'rectangle' ? item.height : 1),
                  item.y + delta[1],
                ),
              );
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
  if (!navigating && (dirty() || busy)) {
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
    : choosingProject
      ? 'Choose a project or create a new one.'
      : 'Name your project to get started.';
});
