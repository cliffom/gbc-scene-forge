/** Standalone project controller for atlas, layer and object authoring. */
import { createEditorLayout } from './editor-layout.mts';
import { createFirstSceneGuide } from './first-scene-guide.mts';
import { createDiagnosticsView } from './diagnostics-view.mts';
import type { DiagnosticLocation } from './diagnostics-view.mts';
import { createWorldView } from './world-view.mts';
import { decodeWorld, decodeWorldSnapshot } from './world.mts';
import type { World, Endpoint } from './world.mts';
import { createDefinitionLibrary } from './definition-library.mts';
import {
  describeFinding,
  decodeDefinitions,
  definitionInstance,
  resolveDefinition,
} from './object-definitions.mts';
import type { ObjectDefinition } from './object-definitions.mts';
import { resizeScene } from './scene-size.mts';
import { capture, eraseCaptured, paste, transform } from './compositions.mts';
import type { Composition, CompositionSelection } from './compositions.mts';
import { tileParts, tileContext, transformMetadata } from './tile-transform.mts';
import { DraftWriter } from './drafts.mts';
import { HttpError } from './errors.mts';
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
import { layerDragging } from './layer-drag.mts';
import { editorFocus } from './editor-focus.mts';
import type { LayerScene, SceneLayer } from './layers.mts';
import { decodeObject, encodeObject, objectBounds } from './objects.mts';
import type { SceneObject } from './objects.mts';
import { chooseFolder, readBundle } from './atlas-import.mts';
import type { AtlasFolder } from './atlas-import.mts';
import { array, boolean, number, record, string } from './decode.mts';
import type { Decoder } from './decode.mts';
import type { Selection } from './types.ts';
import { createPalettePanel, decodePaletteProfile } from './palette-budget.mts';
import type { PaletteProfile } from './palette-budget.mts';

declare const __FORGE_BUILD_LABEL__: string;
const versionLabel = document.getElementById('app-version');
if (versionLabel) {
  versionLabel.textContent = __FORGE_BUILD_LABEL__;
}

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
  id: string;
  name: string;
  paletteProfile: PaletteProfile | null;
  definitions: ObjectDefinition[];
  world: World;
  stamps: { id: string; name: string; composition: Composition }[];
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
const editorLayout = createEditorLayout();
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
let pendingScene = '';
let token = '';
let previewSettingsLoaded = false;
let atlasFolder: AtlasFolder | null = null;
let revision = '';
let project: Project | null = null;
let loaded: Loaded | null = null;
let committed: Loaded | null = null;
let editor: LayerEditor | null = null;
let baseline = '';
let draftWriter: DraftWriter | null = null;
let recoveredDraft: { id: string; revision: string } | null = null;
let recoveryItems: Record<string, unknown>[] = [];
function newDraftWriter() {
  draftWriter = new DraftWriter(
    (route, payload) => api(route, record, payload),
    (message) => {
      element('draft-status', HTMLElement).textContent = message;
    },
  );
}
function checkpoint() {
  if (busy || anchor || !project || !loaded || !editor || !draftWriter) {
    return;
  }
  draftWriter.observe(
    dirty()
      ? {
          project_id: project.id,
          scene_id: loaded.id,
          name: loaded.name,
          scene_revision: loaded.revision,
          project_revision: revision,
          scene: sceneSnapshot(),
        }
      : null,
  );
}
async function clearDraft() {
  const writer = draftWriter;
  draftWriter = null;
  try {
    await writer?.clear();
    if (recoveredDraft) {
      await api('delete-draft', record, recoveredDraft);
    }
    recoveredDraft = null;
    element('draft-status', HTMLElement).textContent = '';
  } catch (error) {
    element('draft-status', HTMLElement).textContent =
      `Draft cleanup failed; the checkpoint was retained. ${String(error)}`;
  }
}

let brush: string[][] | null = null;
let spriteBrush: string | null = null;
let objectBrush: 'point' | 'rectangle' | null = null;
let definitionBrush: string | null = null;
let selectedObject: string | null = null;
let selectedObjects = new Set<string>();
let clipboard: Composition | null = null;
let stampBrush: Composition | null = null;
function compositionSelection(): CompositionSelection {
  return {
    rectangle: selection,
    objects: selectedObjects.size
      ? selectedObjects
      : new Set(selectedObject ? [selectedObject] : []),
    allLayers: input('select-all-layers').checked || selectedObjects.size > 0,
  };
}
function compositionAction(
  action: 'copy' | 'cut' | 'paste' | 'duplicate' | 'horizontal' | 'vertical' | 'rotate',
) {
  if (!editor || !project || busy || anchor || animationPreview.movement.active) {
    return;
  }
  try {
    const choice = compositionSelection();
    if (action === 'copy' || action === 'cut') {
      clipboard = capture(editor, choice, project.id).composition;
      if (action === 'cut') {
        eraseCaptured(editor, choice);
        selection = null;
        selectedObject = null;
        selectedObjects.clear();
      }
      status.textContent =
        action === 'copy'
          ? 'Selection copied. Paste into a compatible scene in this project.'
          : 'Selection cut.';
    } else if (action === 'paste' || action === 'duplicate') {
      const copied = action === 'duplicate' ? capture(editor, choice, project.id) : null;
      const value = copied?.composition ?? clipboard;
      if (!value) {
        throw Error('Copy a selection first.');
      }
      const x = copied ? copied.x + 1 : (hover?.x ?? selection?.x ?? 0);
      const y = copied ? copied.y + 1 : (hover?.y ?? selection?.y ?? 0);
      selectedObjects = paste(editor, value, project.id, x, y, (asset) => regions.has(asset));
      selectedObject = null;
      if (value.scene.layers.length > 1) {
        input('select-all-layers').checked = true;
      }
      const firstLayer = value.scene.layers[0];
      const targetLayer = editor.layers.filter(
        (l) => l.name === firstLayer.name && l.type === firstLayer.type,
      )[value.slots[0]];
      editor.activate(targetLayer.id);
      selection = value.scene.layers.some((l) => l.type === 'tilelayer')
        ? { x, y, w: value.scene.width, h: value.scene.height }
        : null;
      status.textContent = 'Composition placed. Undo reverses the entire placement.';
    } else {
      const copied = capture(editor, choice, project.id);
      const transformed = transform(copied.composition, action);
      const staged = new LayerEditor(editor.scene, [], editor.descriptor);
      staged.spriteRegion = editor.spriteRegion;
      eraseCaptured(staged, choice);
      paste(
        staged,
        transformed,
        project.id,
        copied.x,
        copied.y,
        (asset) => regions.has(asset),
        false,
      );
      editor.change(() => {
        if (editor) {
          editor.scene = staged.scene;
        }
      });
      selection = {
        x: copied.x,
        y: copied.y,
        w: transformed.scene.width,
        h: transformed.scene.height,
      };
      selectedObject = null;
      selectedObjects.clear();
      status.textContent = 'Selection transformed around its top-left grid origin.';
    }
    draw();
  } catch (error) {
    status.textContent = String(error instanceof Error ? error.message : error);
  }
}
const compositionCommands: Record<string, Parameters<typeof compositionAction>[0]> = {
  'copy-selection': 'copy',
  'cut-selection': 'cut',
  'paste-selection': 'paste',
  'duplicate-selection': 'duplicate',
  'flip-horizontal': 'horizontal',
  'flip-vertical': 'vertical',
  'rotate-selection': 'rotate',
};
for (const [id, action] of Object.entries(compositionCommands)) {
  button(id).onclick = () => compositionAction(action);
}
input('select-all-layers').onchange = () => {
  selection = null;
  selectedObject = null;
  selectedObjects.clear();
  draw();
};
select('stamps').onchange = () => {
  stampBrush = null;
  update();
};
button('save-stamp').onclick = () => {
  if (!editor || !project || busy || anchor) {
    return;
  }
  try {
    const value = capture(editor, compositionSelection(), project.id).composition;
    const name = window.prompt('Name this reusable stamp:');
    if (!name?.trim()) {
      return;
    }
    void run(async () => {
      const scene = {
        ...value.scene,
        layers: value.scene.layers.map((l) => ({
          ...l,
          ...(l.type === 'tilelayer'
            ? { cells: l.cells.map((r) => r.map((c) => (c === 'empty' ? '' : c))) }
            : { objects: l.objects.map(encodeObject) }),
        })),
      };
      await api('save-stamp', record, {
        name,
        scene,
        slots: value.slots,
        project_revision: revision,
      });
      await refresh();
      draw();
      editorLayout.showLibrary('stamps');
      status.textContent = 'Reusable stamp saved in the project.';
    });
  } catch (error) {
    status.textContent = String(error);
  }
};
button('place-stamp').onclick = () => {
  definitionBrush = null;
  stampBrush = stampBrush
    ? null
    : (project?.stamps.find((s) => s.id === select('stamps').value)?.composition ?? null);
  status.textContent = stampBrush
    ? 'Click the canvas to place the stamp repeatedly. Escape or choose a tool to stop.'
    : 'Stamp placement stopped.';
  update();
  canvas.focus({ preventScroll: true });
};
button('delete-stamp').onclick = () =>
  void run(async () => {
    await api('delete-stamp', record, { id: select('stamps').value, project_revision: revision });
    stampBrush = null;
    await refresh();
    draw();
  });
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
const palettePanel = createPalettePanel({
  context: () => {
    if (!editor || !loaded || !project) {
      return null;
    }
    const payload = {
      scene_id: loaded.id,
      scene_revision: loaded.revision,
      project_revision: revision,
      scene: sceneSnapshot(),
    };
    return { payload, key: JSON.stringify(payload) };
  },
  report: (preflight, payload) =>
    api(preflight ? 'palette-preflight' : 'palette-report', record, payload),
  save: (profile) => {
    void run(async () => {
      const result = await api('save-palette-profile', record, {
        profile,
        project_revision: revision,
      });
      revision = string(result.revision);
      project = decodeProject(result.project);
      palettePanel.saved();
      status.textContent = 'GBC palette profile saved. Scene content is unchanged.';
    });
  },
  navigate: (source) => {
    if (!editor || !loaded || busy || anchor !== null) {
      return;
    }
    const layer = editor.layers.find((layer) => layer.id === number(source.layer_id));
    if (!layer) {
      return;
    }
    editor.activate(layer.id);
    selectedObject = source.object_id === null ? null : String(number(source.object_id));
    selection =
      source.object_id === null ? { x: number(source.x), y: number(source.y), w: 1, h: 1 } : null;
    element('palette-dialog', HTMLDialogElement).close();
    draw();
    const viewport = element('viewport', HTMLElement);
    const sceneRect = canvas.getBoundingClientRect();
    const viewRect = viewport.getBoundingClientRect();
    const multiplier = source.object_id === null ? loaded.grid : 1;
    viewport.scrollLeft +=
      sceneRect.left +
      number(source.x) * multiplier * sceneZoom() -
      viewRect.left -
      viewport.clientWidth / 2;
    viewport.scrollTop +=
      sceneRect.top +
      number(source.y) * multiplier * sceneZoom() -
      viewRect.top -
      viewport.clientHeight / 2;
    status.textContent = layer.visible
      ? `Palette contributor: ${layer.name} · ${string(source.asset)}`
      : `Palette contributor is on hidden layer “${layer.name}”. Show that layer to inspect it on the canvas.`;
    canvas.focus({ preventScroll: true });
  },
});
let spacePan = false;
let pan: { pointer: number; x: number; y: number; left: number; top: number } | null = null;
const images = new Map<string, HTMLImageElement>();
const regions = new Map<string, { image: HTMLImageElement; x: number; y: number }>();
const sprites = new Map<string, { image: HTMLImageElement; region: Region }>();
const animationPreview = createAnimationPreview(() => draw(false));

function tileMetadata(group: string, asset: string): TileMetadata | undefined {
  const [base, flags] = tileParts(asset);
  const value = project?.atlases[base.split('/')[0]]?.metadata[group]?.[base];
  if (!value || !flags || group === 'sprites') {
    return value;
  }
  return transformMetadata(value, flags, Number(group));
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
const objectInspector = createObjectInspector(
  () => {
    const item = editor?.objects.find((item) => item.id === selectedObject);
    return editor && item ? { editor, item } : null;
  },
  draw,
  () => project?.definitions ?? [],
);
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
    definitionBrush = null;
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
    syncPanCursor();
    element('paint-label', HTMLElement).textContent = 'Place object';
    element('selected-brush', HTMLElement).textContent =
      kind === 'point' ? 'Spawn point' : 'Trigger area';
    status.textContent =
      'Click to place an object. Select it to edit its name, class, dimensions and properties.';
    draw();
  };
}
async function definitionMutation(route: string, payload: Record<string, unknown>) {
  if (busy) {
    throw Error('Wait for the current operation.');
  }
  busy = true;
  update();
  try {
    const result = await api(route, record, { ...payload, project_revision: revision });
    project = decodeProject(result.project);
    revision = string(result.revision);
    definitionBrush = null;
    status.textContent =
      'Object definition library saved. Scene history and unsaved edits are preserved.';
    draw();
  } finally {
    busy = false;
    update();
  }
}
let pendingDiagnostic: DiagnosticLocation | null = null;
function focusDiagnostic() {
  const location = pendingDiagnostic;
  pendingDiagnostic = null;
  if (!location || !editor || !location.scene || location.scene !== loaded?.id) {
    return;
  }
  const item = editor.layers
    .flatMap((l) => (l.type === 'objectgroup' ? l.objects : []))
    .find((o) => Number(o.id) === location.object);
  if (location.object) {
    pendingWorldEndpoint = { scene: location.scene, object: location.object };
    focusWorldEndpoint();
  } else if (location.layer && editor.layers.some((l) => l.id === location.layer)) {
    editor.activate(location.layer);
    draw();
  }
  const x = location.x ?? item?.x,
    y = location.y ?? item?.y;
  if (x !== undefined && y !== undefined) {
    const viewport = element('viewport', HTMLElement);
    const scale = canvas.getBoundingClientRect().width / canvas.width;
    viewport.scrollTo(
      Math.max(0, x * scale - viewport.clientWidth / 2),
      Math.max(0, y * scale - viewport.clientHeight / 2),
    );
  }
}
let pendingWorldEndpoint: Endpoint | null = null;
function focusWorldEndpoint() {
  const endpoint = pendingWorldEndpoint;
  pendingWorldEndpoint = null;
  if (!endpoint || !editor || loaded?.id !== endpoint.scene || !endpoint.object) {
    return;
  }
  const layer = editor.layers.find(
    (l) => l.type === 'objectgroup' && l.objects.some((o) => Number(o.id) === endpoint.object),
  );
  if (!layer) {
    status.textContent =
      'Connection endpoint object is missing. Choose a replacement in World view.';
    return;
  }
  editor.activate(layer.id);
  selectedObject = String(endpoint.object);
  selectedObjects.clear();
  selection = null;
  draw();
  status.textContent = layer.visible
    ? 'Connection endpoint selected.'
    : 'Connection endpoint selected on a hidden layer. Show its layer to edit it.';
}
const worldView = createWorldView(
  async () => {
    const report = await api('world-report', record, {
      project_revision: revision,
      ...(loaded && editor
        ? { scene_id: loaded.id, scene_revision: loaded.revision, scene: sceneSnapshot() }
        : {}),
    });
    return {
      world: project?.world ?? decodeWorld(undefined),
      snapshot: decodeWorldSnapshot(report),
    };
  },
  async (world, sceneRevisions) => {
    if (busy) {
      throw Error('Wait for the current operation.');
    }
    busy = true;
    update();
    try {
      const result = await api('save-world', record, {
        world,
        scene_revisions: sceneRevisions,
        project_revision: revision,
      });
      project = decodeProject(result.project);
      revision = string(result.revision);
      status.textContent = 'World saved. Open scene edits and history are preserved.';
    } finally {
      busy = false;
      update();
    }
  },
  (endpoint) => {
    pendingWorldEndpoint = endpoint;
    if (endpoint.scene === loaded?.id) {
      focusWorldEndpoint();
      return;
    }
    if (!project?.scenes.some((s) => s.id === endpoint.scene)) {
      pendingWorldEndpoint = null;
      status.textContent = 'Connection destination scene is missing.';
      return;
    }
    requestSceneOpen(endpoint.scene);
  },
);
button('show-world').onclick = () => void run(() => worldView.open());
const diagnosticsView = createDiagnosticsView(
  () => ({ definitions: project?.definitions ?? [], scenes: project?.scenes ?? [] }),
  (options) =>
    api('diagnostics-report', record, {
      options,
      project_revision: revision,
      ...(loaded && editor
        ? { scene_id: loaded.id, scene_revision: loaded.revision, scene: sceneSnapshot() }
        : {}),
    }),
  (location) => {
    if (location.scene && project?.scenes.some((s) => s.id === location.scene)) {
      pendingDiagnostic = location;
      if (location.scene === loaded?.id) {
        focusDiagnostic();
      } else {
        requestSceneOpen(location.scene);
      }
    } else if (location.connection) {
      void run(() => worldView.open());
    } else if (location.asset) {
      editorLayout.showLibrary('artwork');
      status.textContent = `Unused asset ${location.asset}. Select it in the palette to inspect its artwork and metadata.`;
      input('search').value = '';
      select('atlas-filter').value = '';
      select('kind-filter').value = '';
      filterPalette();
      const node = Array.from(element('palette', HTMLElement).querySelectorAll('button')).find(
        (b) => b.dataset.asset === location.asset?.split('/').slice(0, 2).join('/'),
      );
      node?.scrollIntoView({ block: 'center' });
      node?.focus();
    }
  },
);
button('show-diagnostics').onclick = () => diagnosticsView.open();
const definitionLibrary = createDefinitionLibrary(
  () => project?.definitions ?? [],
  () =>
    Object.entries(project?.atlases ?? {}).flatMap(([id, a]) =>
      a.regions.filter((r) => r.kind === 'sprite').map((r) => `${id}/${r.name}`),
    ),
  (value) => definitionMutation('save-object-definition', { definition: value }),
  (id) => definitionMutation('delete-object-definition', { id }),
);
button('manage-definitions').onclick = () => definitionLibrary.open();
button('place-definition').onclick = () => {
  if (!editor || busy || !project) {
    return;
  }
  const definition = project.definitions.find(
    (d) => d.id === select('object-definition-brush').value,
  );
  if (!definition) {
    return;
  }
  const layer =
    editor.active.type === 'objectgroup' && editor.active.visible
      ? editor.active
      : editor.layers.find((l) => l.visible && l.type === 'objectgroup');
  if (!layer) {
    status.textContent = 'Add an object layer before placing instances.';
    return;
  }
  editor.activate(layer.id);
  brush = null;
  spriteBrush = null;
  objectBrush = null;
  stampBrush = null;
  definitionBrush = definition.id;
  const tool = document.querySelector<HTMLInputElement>('input[value="paint"]');
  if (tool) {
    tool.checked = true;
  }
  element('paint-label', HTMLElement).textContent = 'Place instance';
  element('selected-brush', HTMLElement).textContent = definition.name;
  status.textContent =
    'Click to place an instance. Select it to set overrides or reset shared defaults.';
  draw();
};
select('object-definition-brush').onchange = () => {
  definitionBrush = null;
  update();
};
let renderedDefinitions = '';
function renderObjectValidation() {
  const encoded = JSON.stringify(project?.definitions ?? []);
  if (encoded !== renderedDefinitions) {
    const previous = select('object-definition-brush').value;
    select('object-definition-brush').replaceChildren(
      new Option('Choose definition…', ''),
      ...(project?.definitions ?? []).map((d) => new Option(d.name, d.id)),
    );
    select('object-definition-brush').value = project?.definitions.some((d) => d.id === previous)
      ? previous
      : '';
    renderedDefinitions = encoded;
  }
  const container = element('object-findings', HTMLElement);
  container.replaceChildren();
  let instances = 0,
    count = 0;
  for (const layer of editor?.layers ?? []) {
    if (layer.type !== 'objectgroup') {
      continue;
    }
    for (const item of layer.objects) {
      if (!item.definition) {
        continue;
      }
      instances++;
      const findings = resolveDefinition(item, project?.definitions ?? []).findings;
      count += findings.length;
      for (const finding of findings) {
        if (container.children.length >= 100) {
          break;
        }
        const link = document.createElement('button');
        link.className = 'small';
        link.disabled = busy || anchor !== null;
        link.textContent = `${layer.name} / ${item.name || '#' + item.id} / ${finding.field || 'definition'}: ${describeFinding(item, finding, project?.definitions ?? [])}${layer.visible ? '' : ' (hidden layer)'}`;
        link.onclick = () => {
          if (!editor || busy || anchor) {
            return;
          }
          editor.activate(layer.id);
          selectedObject = item.id;
          selectedObjects.clear();
          selection = null;
          if (!layer.visible) {
            status.textContent = 'Show this layer to edit its object.';
          }
          draw();
        };
        container.append(link);
      }
    }
  }
  element('object-validation-summary', HTMLElement).textContent = editor
    ? `${instances} linked instances · ${count} findings${count > 100 ? ' (first 100 shown)' : ''}. Checks include hidden layers and current unsaved edits.`
    : 'Open a scene to validate its objects.';
}
select('object-list').onchange = () => {
  selectedObjects.clear();
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
  if (!response.ok && !(route === 'palette-preflight' && response.status === 422)) {
    const body: unknown = await response.json();
    throw new HttpError(string(record(body).error), response.status);
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
    id: string(data.id),
    name: string(data.name),
    paletteProfile: decodePaletteProfile(data.gbc_palette_profile),
    definitions: decodeDefinitions(data.object_definitions),
    world: decodeWorld(data.world),
    stamps: array(data.stamps ?? [], (value) => {
      const stamp = record(value);
      const loaded = decodeLoaded({
        id: stamp.id,
        name: stamp.name,
        revision: '',
        scene: stamp.scene,
      });
      return {
        id: string(stamp.id),
        name: string(stamp.name),
        composition: {
          project: string(data.id),
          slots: array(stamp.slots, number),
          scene: {
            width: loaded.width,
            height: loaded.height,
            grid: loaded.grid,
            layers: loaded.layers,
            next_layer_id: loaded.nextLayerId,
            next_object_id: loaded.nextObjectId,
          },
        },
      };
    }),
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
        width: editor.scene.width,
        height: editor.scene.height,
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
  renderObjectValidation();
  button('show-first-scene-guide').disabled = busy || anchor !== null;
  for (const id of ['scene-commands', 'project-commands']) {
    button(id).disabled = busy || !project || anchor !== null;
  }
  button('show-world').disabled = busy || !project || anchor !== null;
  button('show-diagnostics').disabled = busy || !project || anchor !== null;
  button('manage-definitions').disabled = busy || !project || anchor !== null;
  button('place-definition').disabled =
    busy || !editor || !select('object-definition-brush').value || anchor !== null;
  select('object-definition-brush').disabled = busy || !project;
  checkpoint();
  button('show-recovery').disabled = busy || anchor !== null || dirty();
  palettePanel.sync(project?.paletteProfile ?? null, busy || anchor !== null);
  if (busy || !editor) {
    spacePan = false;
    finishPan();
  }
  syncPanCursor();
  select('switch-project').disabled = busy || anchor !== null || !projectBase;
  button('show-new-project').disabled = button('back-to-projects').disabled = busy;
  for (const id of ['switch-save', 'switch-discard', 'switch-cancel']) {
    button(id).disabled = busy;
  }
  for (const id of ['scene-switch-save', 'scene-switch-discard', 'scene-switch-cancel']) {
    button(id).disabled = busy;
  }
  element('dirty', HTMLElement).textContent = !editor ? 'NO SCENE' : dirty() ? 'UNSAVED' : 'SAVED';
  element('dirty', HTMLElement).dataset.dirty = String(dirty());
  button('save-preview-settings').disabled = busy || !project;
  const unsaved = Boolean(editor && dirty());
  button('save').disabled = busy || !unsaved;
  button('save').classList.toggle('primary', unsaved);
  const saveState = element('scene-save-state', HTMLElement);
  const saveText = !editor ? '' : unsaved ? 'Unsaved changes' : 'Saved';
  if (saveState.textContent !== saveText) {
    saveState.textContent = saveText;
  }
  saveState.dataset.dirty = String(unsaved);
  button('fit-scene').disabled = !editor;
  select('zoom').disabled = !editor;
  button('library-import').disabled = busy || anchor !== null;
  button('show-export').disabled = busy || !project || anchor !== null;
  button('show-palettes').disabled = busy || !project || anchor !== null;
  button('export-confirm').disabled = button('export-cancel').disabled = busy;
  select('export-scope').disabled = busy;
  input('export-canvas').disabled = busy || !editor || !dirty();
  button('undo').disabled = busy || !editor?.undoStack.length;
  button('redo').disabled = busy || !editor?.redoStack.length;
  button('revert').disabled = busy || !dirty();
  const hasComposition = Boolean(selection || selectedObject || selectedObjects.size);
  button('transform-commands').disabled = busy || !editor || !hasComposition || anchor !== null;
  for (const id of [
    'copy-selection',
    'cut-selection',
    'duplicate-selection',
    'flip-horizontal',
    'flip-vertical',
    'rotate-selection',
    'save-stamp',
  ]) {
    button(id).disabled = busy || !editor || !hasComposition || anchor !== null;
  }
  button('paste-selection').disabled = busy || !editor || !clipboard || anchor !== null;
  button('place-stamp').disabled = busy || !editor || !select('stamps').value;
  button('place-stamp').setAttribute('aria-pressed', String(stampBrush !== null));
  button('place-stamp').textContent = stampBrush ? 'Stop placing' : 'Place stamp';
  select('stamps').title = select('stamps').selectedOptions[0]?.textContent ?? '';
  select('stamps').disabled = busy || !project?.stamps.length;
  button('delete-stamp').disabled = busy || !select('stamps').value;
  input('select-all-layers').disabled = busy || !editor || anchor !== null;
  button('deselect').disabled = busy || (!selection && !selectedObject && !selectedObjects.size);
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
          (definitionBrush !== null ||
            spriteBrush !== null ||
            objectBrush !== null ||
            editor?.active.type !== 'tilelayer'));
    }
  }
  for (const control of document.querySelectorAll<
    HTMLButtonElement | HTMLInputElement | HTMLSelectElement
  >('#project-form button, #import-form button, #scene-form button')) {
    control.disabled = busy;
  }
  select('scenes').disabled = busy || anchor !== null || !project?.scenes.length;
  for (const id of ['show-rename', 'show-duplicate-scene', 'show-resize']) {
    button(id).disabled = busy || !editor || anchor !== null;
  }
  button('scene-manage-confirm').disabled = busy;
  button('resize-confirm').disabled = busy;
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
  renderLayerContext();
  inspect();
}
function renderLayers() {
  const list = element('layers', HTMLElement);
  const disabled = busy || !editor || anchor !== null;
  const focused = document.activeElement;
  const rows = (editor ? [...editor.layers].reverse() : []).map((layer) => {
    let row = list.querySelector<HTMLDivElement>(`[data-layer-id="${layer.id}"]`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'layer-row';
      row.dataset.layerId = String(layer.id);
      row.innerHTML =
        '<span class="layer-grip" aria-hidden="true" title="Drag to reorder layer">⠿</span><label class="layer-choice"><input type="radio" name="active-layer"><span class="layer-icon" aria-hidden="true"></span><span class="layer-detail"><span class="layer-name"></span><span class="layer-meta"></span></span></label><button class="layer-eye" type="button"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="eye-slash" d="m3 3 18 18"/></svg></button>';
    }
    const radio = row.querySelector('input');
    const eye = row.querySelector('button');
    const icon = row.querySelector('.layer-icon');
    const name = row.querySelector('.layer-name');
    const meta = row.querySelector('.layer-meta');
    if (!radio || !eye || !icon || !name || !meta) {
      throw new Error('Layer row controls are missing.');
    }
    radio.onchange = () => layerAction((editor) => editor.activate(layer.id));
    eye.onclick = () =>
      layerAction((editor) => editor.visibility(layer.id), layer.id === editor?.active.id);
    eye.disabled = disabled;
    eye.setAttribute('aria-label', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
    eye.setAttribute('aria-pressed', String(layer.visible));
    eye.title = `${layer.visible ? 'Hide' : 'Show'} layer`;
    radio.value = String(layer.id);
    radio.checked = layer.id === editor?.active.id;
    radio.disabled = disabled;
    row.dataset.visible = String(layer.visible);
    icon.textContent = layer.type === 'tilelayer' ? '▦' : '◇';
    name.textContent = layer.name;
    meta.textContent = `${layer.type === 'tilelayer' ? 'Tiles' : 'Objects'} · ${layer.visible ? 'Visible' : 'Hidden'}`;
    return row;
  });
  // Keep existing inputs mounted during canvas redraws and keyboard navigation.
  if (rows.length !== list.children.length || rows.some((row, i) => row !== list.children[i])) {
    list.replaceChildren(...rows);
    if (focused instanceof HTMLElement && list.contains(focused)) {
      focused.focus({ preventScroll: true });
    }
  }
  if (!editor) {
    list.textContent = 'Open a scene to view its layers.';
  }
  list.setAttribute('aria-disabled', String(disabled));
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
    button('layer-visible').textContent = editor.active.visible ? 'Hide layer' : 'Show layer';
  }
}
function layerAction(work: (editor: LayerEditor) => void, clearSelection = true) {
  if (!editor || busy || anchor) {
    return;
  }
  try {
    work(editor);
    if (clearSelection) {
      selection = null;
      selectedObject = null;
      selectedObjects.clear();
      objectDrag = null;
    }
    input('layer-name').value = editor.active.name;
    draw();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
input('layer-name').onchange = () =>
  layerAction((editor) => editor.rename(input('layer-name').value));
button('layer-tile').onclick = () => layerAction((editor) => editor.add('tilelayer'));
button('layer-object').onclick = () => layerAction((editor) => editor.add('objectgroup'));
button('layer-up').onclick = () => layerAction((editor) => editor.reorder(1));
button('layer-down').onclick = () => layerAction((editor) => editor.reorder(-1));
button('layer-visible').onclick = () => layerAction((editor) => editor.visibility());
button('layer-remove').onclick = () => layerAction((editor) => editor.remove());
layerDragging(element('layers', HTMLElement), (id, before) =>
  layerAction((editor) => editor.moveLayer(id, before), false),
);
function renderLayerContext() {
  const context = element('layer-context', HTMLElement);
  context.hidden = !editor;
  if (!editor) {
    return;
  }
  const layer = editor.active;
  const tool = spacePan
    ? 'pan'
    : document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
  const action =
    tool === 'select'
      ? 'Selecting'
      : tool === 'erase'
        ? 'Erasing'
        : tool === 'fill'
          ? 'Filling'
          : tool === 'pan'
            ? 'Panning'
            : objectBrush
              ? 'Placing objects'
              : spriteBrush
                ? 'Placing sprites'
                : 'Painting';
  const text = layer.visible ? `${action} on ${layer.name}` : `${layer.name} is hidden`;
  const label = element('layer-context-text', HTMLElement);
  if (label.textContent !== text) {
    label.textContent = text;
  }
  context.dataset.hiddenLayer = String(!layer.visible);
  button('context-show-layer').hidden = layer.visible;
  button('context-show-layer').disabled = busy || anchor !== null;
}
button('context-show-layer').onclick = () => layerAction((editor) => editor.visibility());
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
  const inspectedObjects = editor?.active.type === 'objectgroup' ? editor.active.objects : [];
  const item = inspectedObjects.find((r) => r.id === selectedObject);
  const inspector = document.querySelector('.inspector');
  const hasSelection = Boolean(item || selection || selectedObjects.size);
  if (inspector instanceof HTMLElement) {
    const wasSelected = inspector.classList.contains('has-selection');
    inspector.classList.toggle('has-selection', hasSelection);
    if (hasSelection && !wasSelected) {
      inspector.scrollTop = 0;
    }
  }
  select('object-list').replaceChildren(
    ...(inspectedObjects.map(
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
    element('selection-kind', HTMLElement).textContent =
      input('select-all-layers').checked || editor?.active.type === 'objectgroup'
        ? 'COMPOSITION'
        : 'TILES';
    element('selection-name', HTMLElement).textContent = `${selection.w} × ${selection.h} cells`;
    element('selection-detail', HTMLElement).textContent =
      `Column ${selection.x}, row ${selection.y}. Arrow keys move the selection; Delete erases it.`;
  } else if (selectedObjects.size) {
    element('selection-kind', HTMLElement).textContent = 'OBJECTS';
    element('selection-name', HTMLElement).textContent = `${selectedObjects.size} objects selected`;
    element('selection-detail', HTMLElement).textContent =
      'Copy, cut, duplicate or save this group as a reusable stamp. Shift-click toggles objects; Delete removes the group.';
  } else {
    element('selection-kind', HTMLElement).textContent = '—';
    element('selection-name', HTMLElement).textContent = 'Nothing selected';
    element('selection-detail', HTMLElement).textContent =
      'Select an object on the canvas or in the list to edit it, or select tiles on a tile layer.';
  }
}
async function run(work: () => Promise<void> | void) {
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
const folderPopover = element('folder-popover', HTMLElement);
function positionFolderPopover() {
  if (!folderPopover.matches(':popover-open')) {
    return;
  }
  const trigger = button('project-folder').getBoundingClientRect();
  const panel = folderPopover.getBoundingClientRect();
  folderPopover.style.left = `${Math.max(16, Math.min(trigger.right - panel.width, innerWidth - panel.width - 16))}px`;
  folderPopover.style.top = `${Math.max(16, Math.min(trigger.bottom + 8, innerHeight - panel.height - 16))}px`;
}
folderPopover.addEventListener('toggle', () => {
  element('folder-copy-status', HTMLElement).textContent = '';
  positionFolderPopover();
});
window.addEventListener('resize', positionFolderPopover);
button('copy-folder').onclick = async () => {
  const copy = button('copy-folder');
  const feedback = element('folder-copy-status', HTMLElement);
  copy.disabled = true;
  try {
    await navigator.clipboard.writeText(element('folder-path', HTMLElement).textContent || '');
    feedback.textContent = 'Path copied.';
  } catch {
    feedback.textContent = 'Copy unavailable. Select the path above to copy it.';
  } finally {
    copy.disabled = false;
    positionFolderPopover();
  }
};
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
  const folderPath = string(choosingProject ? data.project_root : data.project_path);
  const folderLabel = choosingProject ? 'Projects folder' : 'Project folder';
  element('folder-path', HTMLElement).textContent = folderPath;
  element('folder-name', HTMLElement).textContent =
    folderPath.split(/[\\/]/).filter(Boolean).at(-1) || folderPath;
  element('folder-heading', HTMLElement).textContent = folderLabel;
  button('project-folder').disabled = false;
  button('project-folder').setAttribute('aria-label', `${folderLabel}: ${folderPath}`);
  button('project-folder').title = folderLabel;
  element('folder-copy-status', HTMLElement).textContent = '';
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
  const previousStamp = select('stamps').value;
  select('stamps').replaceChildren(
    new Option('Choose stamp…', ''),
    ...(project?.stamps.map((s) => new Option(s.name, s.id)) ?? []),
  );
  select('stamps').value = project?.stamps.some((s) => s.id === previousStamp) ? previousStamp : '';
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
  const placeholder = new Option('Choose a scene…', '');
  placeholder.disabled = true;
  select('scenes').replaceChildren(
    placeholder,
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
  definitionBrush = null;
  objectBrush = null;
  if (!project) {
    return;
  }
  const size = loaded?.grid ?? 8;
  let initialBrush: (() => void) | null = null;
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
      const chooseAsset = (reveal = true) => {
        if (reveal) {
          editorLayout.showLibrary('artwork');
        }
        stampBrush = null;
        if (editor && editor.active.type !== (sprite ? 'objectgroup' : 'tilelayer')) {
          const layer = editor.layers.find(
            (layer) => layer.visible && layer.type === (sprite ? 'objectgroup' : 'tilelayer'),
          );
          if (layer) {
            editor.activate(layer.id);
            selection = null;
            selectedObject = null;
            selectedObjects.clear();
          }
        }
        definitionBrush = null;
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
        syncPanCursor();
        status.textContent = sprite
          ? `Click the canvas to place ${region.name}. Select to drag it; Delete removes it.`
          : `Paint ${region.name}.`;
        draw();
      };
      item.onclick = () => chooseAsset();
      paletteElement.append(item);
      if (!initialBrush && !item.disabled) {
        initialBrush = () => chooseAsset(false);
      }
    }
  }
  initialBrush?.();
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
  stampBrush = null;
  definitionBrush = null;
  committed = data;
  newDraftWriter();
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
  selectedObjects.clear();
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
  if (
    selectedObject &&
    !(
      editor.active.type === 'objectgroup' &&
      editor.active.objects.some((item) => item.id === selectedObject)
    )
  ) {
    selectedObject = null;
    selectedObjects.clear();
  }
  selectedObjects = new Set(
    [...selectedObjects].filter((id) =>
      editor?.layers.some((l) => l.type === 'objectgroup' && l.objects.some((o) => o.id === id)),
    ),
  );
  loaded = { ...loaded, width: editor.scene.width, height: editor.scene.height };
  element('scene-name', HTMLElement).textContent =
    `${loaded.name} · ${loaded.width} × ${loaded.height} · ${loaded.grid}px`;
  const size = loaded.grid;
  canvas.width = loaded.width * size;
  canvas.height = loaded.height * size;
  const zoom = sceneZoom();
  canvas.style.width = `${canvas.width * zoom}px`;
  canvas.style.height = `${canvas.height * zoom}px`;
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
          const [asset, flags] = tileParts(cell);
          const region = regions.get(asset);
          if (region) {
            context.save();
            context.translate(x * size, y * size);
            tileContext(context, flags, size);
            context.drawImage(region.image, region.x, region.y, size, size, 0, 0, size, size);
            context.restore();
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
  for (const layer of editor.layers) {
    if (layer.visible && layer.type === 'objectgroup') {
      for (const item of layer.objects) {
        if (selectedObjects.has(item.id)) {
          const r = bounds(item);
          context.strokeStyle = '#f2d67b';
          context.lineWidth = 1;
          context.strokeRect(r.x, r.y, r.width, r.height);
        }
      }
    }
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
  if (hover && tool !== 'pan' && !spacePan && !pan) {
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
      if (p.x < 0 || p.y < 0 || p.x >= editor.scene.width || p.y >= editor.scene.height) {
        throw Error('Selection is outside the scene.');
      }
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
function panEnabled() {
  return (
    spacePan ||
    document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value === 'pan'
  );
}
function syncPanCursor() {
  const viewport = element('viewport', HTMLElement);
  viewport.dataset.pan = String(Boolean(editor && !busy && panEnabled()));
  viewport.dataset.panning = String(pan !== null);
}
function finishPan() {
  const pointer = pan?.pointer;
  pan = null;
  const viewport = element('viewport', HTMLElement);
  if (pointer !== undefined && viewport.hasPointerCapture(pointer)) {
    viewport.releasePointerCapture(pointer);
  }
  syncPanCursor();
}
function releaseSpacePan() {
  const held = spacePan;
  spacePan = false;
  finishPan();
  if (held) {
    draw();
  }
}
function panShortcutBlocked(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, select, textarea, button, a, [contenteditable]:not([contenteditable="false"]), dialog, #animation-preview',
      ),
    )
  );
}
editorFocus(element('workspace', HTMLElement), canvas, () => Boolean(editor));
const viewport = element('viewport', HTMLElement);
viewport.addEventListener(
  'pointerdown',
  (event) => {
    if (!editor || busy || !panEnabled() || event.button !== 0 || !event.isPrimary || anchor) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    canvas.focus({ preventScroll: true });
    viewport.setPointerCapture(event.pointerId);
    pan = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    syncPanCursor();
  },
  true,
);
viewport.addEventListener(
  'pointermove',
  (event) => {
    if (!pan || event.pointerId !== pan.pointer) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    viewport.scrollLeft = pan.left - event.clientX + pan.x;
    viewport.scrollTop = pan.top - event.clientY + pan.y;
  },
  true,
);
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  viewport.addEventListener(
    type,
    (event) => {
      if (!pan || event.pointerId !== pan.pointer) {
        return;
      }
      event.stopPropagation();
      finishPan();
    },
    true,
  );
}
document.addEventListener(
  'keydown',
  (event) => {
    if (event.code !== 'Space' && event.key !== ' ') {
      return;
    }
    if (spacePan) {
      event.preventDefault();
      return;
    }
    if (
      !editor ||
      busy ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      document.querySelector('dialog[open], [popover]:popover-open') ||
      panShortcutBlocked(event.target)
    ) {
      return;
    }
    event.preventDefault();
    if (
      event.repeat ||
      anchor ||
      editor.stroke ||
      document.querySelector('#layers[data-dragging=true]')
    ) {
      return;
    }
    spacePan = true;
    syncPanCursor();
    draw();
  },
  true,
);
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space' || event.key === ' ') {
    releaseSpacePan();
  }
});
window.addEventListener('blur', releaseSpacePan);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    releaseSpacePan();
  }
});
document.addEventListener('focusin', (event) => {
  if (spacePan && panShortcutBlocked(event.target)) {
    releaseSpacePan();
  }
});
canvas.onpointerdown = (event) => {
  if (!editor || busy || event.button !== 0) {
    return;
  }
  if (
    definitionBrush &&
    project &&
    document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value === 'paint'
  ) {
    try {
      const definition = project.definitions.find((d) => d.id === definitionBrush);
      if (!definition) {
        throw Error('Choose an existing definition.');
      }
      const p = point(event);
      const position = spritePosition(p.px, p.py, event.altKey);
      selectedObject = editor.createObject(definitionInstance(definition, position.x, position.y));
      selectedObjects.clear();
      selection = null;
      draw();
    } catch (error) {
      status.textContent = String(error);
    }
    return;
  }
  if (stampBrush && project) {
    try {
      const p = point(event);
      paste(editor, stampBrush, project.id, p.x, p.y, (asset) => regions.has(asset));
      draw();
    } catch (error) {
      status.textContent = String(error);
    }
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  anchor = point(event);
  trackHover(event);
  const tool = document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
  editor.begin();
  if (tool === 'select') {
    const hit = hitObject(anchor.px, anchor.py);
    if (event.shiftKey && hit) {
      if (selectedObject) {
        selectedObjects.add(selectedObject);
      }
      if (selectedObjects.has(hit.id)) {
        selectedObjects.delete(hit.id);
      } else {
        selectedObjects.add(hit.id);
      }
      selectedObject = null;
      selection = null;
      objectDrag = null;
      anchor = null;
      editor.end();
      draw();
      return;
    }
    selectedObjects.clear();
    selectedObject = hit?.id ?? null;
    selection = null;
    objectDrag = hit ? { id: hit.id, x: hit.x, y: hit.y } : null;
  }
  paint(event);
};
canvas.onpointermove = (event) => {
  const previous = hover;
  trackHover(event);
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
  update();
};
canvas.onpointercancel = () => {
  editor?.cancel();
  anchor = null;
  objectDrag = null;
  draw();
};
canvas.onlostpointercapture = () => {
  editor?.end();
  anchor = null;
  objectDrag = null;
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
const firstSceneGuide = createFirstSceneGuide(() => !busy, editorLayout.reveal);
form('project-form').onsubmit = (event) => {
  event.preventDefault();
  void run(async () => {
    const continuingGuide = input('continue-guide').checked;
    const result = await api('create-project', record, {
      name: input('project-title').value,
      starter: select('project-starter').value,
    });
    if (choosingProject) {
      navigating = true;
      location.assign(
        `/projects/${encodeURIComponent(string(result.directory))}/${continuingGuide ? '?guide=1' : ''}`,
      );
      return;
    }
    await refresh();
    status.textContent = 'Project created. Choose a scene or create your own.';
    if (continuingGuide) {
      firstSceneGuide.continueInProject();
    }
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
    await clearDraft();
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
    await clearDraft();
    await refresh();
    open(data);
    element('create-scene-dialog', HTMLDialogElement).close();
    status.textContent = 'Scene created. Choose a region and paint.';
  });
};
async function openSavedScene(id: string) {
  const data = await api(`scene/${id}`, decodeLoaded);
  await clearDraft();
  await refresh();
  open(data);
  status.textContent = 'Scene opened.';
  await showRecovery(id);
  focusWorldEndpoint();
  focusDiagnostic();
}
select('scenes').onchange = () => {
  const id = select('scenes').value;
  select('scenes').value = loaded?.id || '';
  pendingWorldEndpoint = null;
  pendingDiagnostic = null;
  requestSceneOpen(id);
};
function requestSceneOpen(id: string) {
  if (busy || anchor || !id || id === loaded?.id) {
    return;
  }
  if (dirty()) {
    pendingScene = id;
    const dialog = element('switch-scene-dialog', HTMLDialogElement);
    dialog.querySelector('.form-error')?.replaceChildren();
    const target = project?.scenes.find((scene) => scene.id === id)?.name || 'another scene';
    element('switch-scene-description', HTMLElement).textContent =
      `This scene has unsaved changes. Save them before opening “${target}”.`;
    dialog.showModal();
  } else {
    void run(() => openSavedScene(id));
  }
}
function confirmSceneSwitch(save: boolean) {
  if (!pendingScene || busy) {
    return;
  }
  void run(async () => {
    if (save) {
      await saveScene();
    }
    await openSavedScene(pendingScene);
    element('switch-scene-dialog', HTMLDialogElement).close();
  });
}
button('scene-switch-save').onclick = () => confirmSceneSwitch(true);
button('scene-switch-discard').onclick = () => confirmSceneSwitch(false);
button('scene-switch-cancel').onclick = () => {
  if (!busy) {
    element('switch-scene-dialog', HTMLDialogElement).close();
  }
};
element('switch-scene-dialog', HTMLDialogElement).oncancel = (event) => {
  if (busy) {
    event.preventDefault();
  }
};
element('switch-scene-dialog', HTMLDialogElement).onclose = () => {
  // A queued close event may arrive after a new confirmation has already opened.
  if (!element('switch-scene-dialog', HTMLDialogElement).open) {
    pendingScene = '';
    pendingDiagnostic = null;
  }
};
function sceneSnapshot() {
  if (!editor || !loaded) {
    throw Error('Open a scene first.');
  }
  return {
    width: editor.scene.width,
    height: editor.scene.height,
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
  const ids = new Set(
    editor.layers.flatMap((l) =>
      l.type === 'objectgroup' ? l.objects.map((o) => Number(o.id)) : [],
    ),
  );
  const savedIds = new Set(
    committed?.layers.flatMap((l) =>
      l.type === 'objectgroup' ? l.objects.map((o) => Number(o.id)) : [],
    ) ?? [],
  );
  const broken =
    project?.world.connections.filter((link) =>
      [link.source, link.destination].some(
        (e) => e.scene === loaded?.id && savedIds.has(e.object) && !ids.has(e.object),
      ),
    ) ?? [];
  if (
    broken.length &&
    !window.confirm(
      `Saving removes endpoints for ${broken.length} connection(s): ${broken.map((l) => l.name).join(', ')}. Keep these connections as broken links and save? Undo can restore the objects.`,
    )
  ) {
    throw Error('Scene save cancelled. Restore the endpoints or update their world connections.');
  }
  const data = await api('save-scene', decodeLoaded, {
    id: loaded.id,
    scene: sceneSnapshot(),
    revision: loaded.revision,
    project_revision: revision,
    confirm_broken_links: broken.length > 0,
  });
  await clearDraft();
  loaded = data;
  stampBrush = null;
  definitionBrush = null;
  committed = data;
  baseline = snapshot();
  newDraftWriter();
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
  void run(async () => {
    await clearDraft();
    navigateProject();
  });
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
button('show-palettes').onclick = () => {
  element('palette-dialog', HTMLDialogElement).showModal();
};
button('palette-close').onclick = () => {
  element('palette-dialog', HTMLDialogElement).close();
};
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
  if (committed && (await discard())) {
    void run(async () => {
      await clearDraft();
      if (committed) {
        open(committed);
      }
    });
  }
};
function sceneZoom() {
  if (select('zoom').value !== 'fit' || !loaded) {
    return Number(select('zoom').value) || 1;
  }
  const viewport = element('viewport', HTMLElement);
  const padding = getComputedStyle(element('canvas-surround', HTMLElement));
  const width =
    viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight) - 2;
  const height =
    viewport.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom) - 2;
  const scale = Math.max(
    1,
    Math.min(8, width / (loaded.width * loaded.grid), height / (loaded.height * loaded.grid)),
  );
  const zoom = Math.floor(scale);
  element('fit-zoom-option', HTMLOptionElement).textContent = `Fit (${zoom}×)`;
  return zoom;
}
function fitScene() {
  if (!editor) {
    return;
  }
  select('zoom').value = 'fit';
  draw();
  element('viewport', HTMLElement).scrollTo(0, 0);
}
button('fit-scene').onclick = fitScene;
let wheelDelta = 0;
let lastWheel = 0;
viewport.addEventListener(
  'wheel',
  (event) => {
    if (
      !editor ||
      busy ||
      document.querySelector('dialog[open], [popover]:popover-open') ||
      event.ctrlKey ||
      event.metaKey ||
      event.deltaY === 0 ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ) {
      return;
    }
    event.preventDefault();
    if (anchor || pan) {
      return;
    }
    const now = performance.now();
    if (now - lastWheel > 180 || Math.sign(wheelDelta) !== Math.sign(event.deltaY)) {
      wheelDelta = 0;
    }
    lastWheel = now;
    wheelDelta +=
      event.deltaY *
      (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    if (Math.abs(wheelDelta) < 40) {
      return;
    }
    const direction = Math.sign(wheelDelta);
    wheelDelta = 0;
    const current = sceneZoom();
    const stops = Array.from(select('zoom').options, (option) => Number(option.value)).filter(
      Number.isFinite,
    );
    const next =
      direction < 0
        ? stops.find((value) => value > current + 0.001)
        : [...stops].reverse().find((value) => value < current - 0.001);
    if (next === undefined) {
      return;
    }
    const before = canvas.getBoundingClientRect();
    const x = (event.clientX - before.left) / before.width;
    const y = (event.clientY - before.top) / before.height;
    select('zoom').value = String(next);
    canvas.style.width = `${canvas.width * next}px`;
    canvas.style.height = `${canvas.height * next}px`;
    const after = canvas.getBoundingClientRect();
    viewport.scrollLeft += after.left + x * after.width - event.clientX;
    viewport.scrollTop += after.top + y * after.height - event.clientY;
    trackHover(event);
    draw();
  },
  { passive: false },
);

select('zoom').onchange = () => {
  draw();
  if (select('zoom').value === 'fit') {
    element('viewport', HTMLElement).scrollTo(0, 0);
  }
};
new ResizeObserver(() => {
  if (editor && select('zoom').value === 'fit') {
    draw(false);
    element('viewport', HTMLElement).scrollTo(0, 0);
  }
}).observe(element('viewport', HTMLElement));
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
let sceneAction: 'rename' | 'duplicate' = 'rename';
let manageRevision = '';
function showSceneManagement(action: 'rename' | 'duplicate') {
  if (!loaded || busy || anchor) {
    return;
  }
  sceneAction = action;
  manageRevision = revision;
  const duplicate = action === 'duplicate';
  const title = duplicate ? 'Duplicate scene' : 'Rename scene';
  element('scene-manage-heading', HTMLElement).textContent = title;
  button('scene-manage-confirm').textContent = title;
  input('scene-manage-name').value = loaded.name + (duplicate ? ' copy' : '');
  element('duplicate-canvas-field', HTMLElement).hidden = !duplicate || !dirty();
  input('duplicate-canvas').checked = false;
  element('scene-manage-hint', HTMLElement).textContent = duplicate
    ? 'Creates a saved, independent scene sharing this project’s artwork. The source stays open with its edits and history. World positions and connections are not copied. Unchecked copies the saved scene.'
    : 'Updates the project name for this scene immediately, preserving its identity and current edits. Scene Undo does not undo a rename.';
  form('scene-manage-form').querySelector('.form-error')?.replaceChildren();
  element('scene-manage-dialog', HTMLDialogElement).showModal();
  input('scene-manage-name').focus();
  input('scene-manage-name').select();
}
button('show-rename').onclick = () => showSceneManagement('rename');
button('show-duplicate-scene').onclick = () => showSceneManagement('duplicate');
form('scene-manage-form').onsubmit = (event) => {
  event.preventDefault();
  if (!loaded || busy) {
    return;
  }
  const current = loaded;
  const action = sceneAction;
  const title = input('scene-manage-name').value.trim();
  void run(async () => {
    const result = await api(`${action}-scene`, record, {
      id: current.id,
      name: title,
      revision: current.revision,
      project_revision: manageRevision,
      ...(action === 'duplicate' && dirty() && input('duplicate-canvas').checked
        ? { scene: sceneSnapshot() }
        : {}),
    });
    project = decodeProject(result.project);
    revision = string(result.revision);
    if (action === 'rename') {
      loaded = { ...current, name: title };
      if (committed) {
        committed = { ...committed, name: title };
      }
    }
    element('scene-manage-dialog', HTMLDialogElement).close();
    await refresh();
    select('scenes').value = current.id;
    draw();
    status.textContent =
      action === 'rename'
        ? `Renamed scene to “${title}”.`
        : `Created “${title}”. Choose it from the scene list to open it.`;
  });
};
function resizeCandidate() {
  if (!editor) {
    throw Error('Open a scene first.');
  }
  return resizeScene(
    editor,
    Number(input('resize-width').value),
    Number(input('resize-height').value),
    select('resize-anchor').value,
  );
}
function previewResize() {
  input('resize-confirm-loss').checked = false;
  try {
    const result = resizeCandidate();
    if (!editor) {
      return;
    }
    const old = editor.scene;
    element('resize-summary', HTMLElement).textContent =
      `${old.width} × ${old.height} → ${result.scene.width} × ${result.scene.height} cells. Remove ${result.tiles} painted tiles and ${result.removed} objects; clip ${result.clipped} rectangles.`;
    element('resize-objects', HTMLElement).replaceChildren(
      ...result.objects.map((label) => {
        const li = document.createElement('li');
        li.textContent = label;
        return li;
      }),
    );
    const preview = element('resize-preview', HTMLCanvasElement);
    const context = preview.getContext('2d');
    if (!context) {
      return;
    }
    const minX = Math.min(0, result.dx),
      minY = Math.min(0, result.dy);
    const maxX = Math.max(result.scene.width, result.dx + old.width);
    const maxY = Math.max(result.scene.height, result.dy + old.height);
    const scale = Math.min(300 / (maxX - minX), 180 / (maxY - minY));
    const x = 10 - minX * scale,
      y = 10 - minY * scale;
    context.clearRect(0, 0, preview.width, preview.height);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      canvas,
      x + result.dx * scale,
      y + result.dy * scale,
      old.width * scale,
      old.height * scale,
    );
    context.save();
    context.beginPath();
    context.rect(
      x + result.dx * scale,
      y + result.dy * scale,
      old.width * scale,
      old.height * scale,
    );
    context.clip();
    context.fillStyle = 'rgba(255, 50, 50, 0.5)';
    context.beginPath();
    context.rect(
      x + result.dx * scale,
      y + result.dy * scale,
      old.width * scale,
      old.height * scale,
    );
    context.rect(x, y, result.scene.width * scale, result.scene.height * scale);
    context.fill('evenodd');
    context.restore();
    context.strokeStyle = '#34d399';
    context.lineWidth = 2;
    context.strokeRect(x, y, result.scene.width * scale, result.scene.height * scale);
  } catch (error) {
    element('resize-summary', HTMLElement).textContent = String(error);
  }
}
button('show-resize').onclick = () => {
  if (!editor || busy || anchor) {
    return;
  }
  input('resize-width').value = String(editor.scene.width);
  input('resize-height').value = String(editor.scene.height);
  select('resize-anchor').value = '0,0';
  form('resize-scene-form').querySelector('.form-error')?.replaceChildren();
  previewResize();
  element('resize-scene-dialog', HTMLDialogElement).showModal();
};
input('resize-width').oninput = previewResize;
input('resize-height').oninput = previewResize;
select('resize-anchor').onchange = previewResize;
form('resize-scene-form').onsubmit = (event) => {
  event.preventDefault();
  if (!editor || busy) {
    return;
  }
  void run(() => {
    const result = resizeCandidate();
    if (
      (result.tiles || result.removed || result.clipped) &&
      !input('resize-confirm-loss').checked
    ) {
      throw Error('Confirm the listed removals and clipping before applying.');
    }
    editor?.change(() => {
      if (editor) {
        editor.scene = result.scene;
      }
    });
    selection = null;
    selectedObject = null;
    selectedObjects.clear();
    hover = null;
    animationPreview.reset();
    element('resize-scene-dialog', HTMLDialogElement).close();
    draw();
    status.textContent = 'Scene resized. Undo restores it; Save commits it to disk.';
  });
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
    const links =
      project?.world.connections.filter(
        (l) => l.source.scene === id || l.destination.scene === id,
      ) ?? [];
    element('delete-scene-links', HTMLElement).textContent = links.length
      ? `This breaks ${links.length} connection(s): ${links.map((l) => l.name).join(', ')}. Connections will be retained for repair in World view. Deleting confirms these broken links.`
      : '';
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
      confirm_broken_links: true,
    });
    if (string(result.deleted) !== candidate.id) {
      throw Error('Unexpected deleted scene response');
    }
    project = decodeProject(result.project);
    revision = string(result.revision);
    if (loaded?.id === candidate.id) {
      await clearDraft();
      loaded = null;
      editor = null;
      baseline = '';
      selection = null;
      selectedObject = null;
      selectedObjects.clear();
      objectDrag = null;
      anchor = null;
      hover = null;
      brush = null;
      spriteBrush = null;
      definitionBrush = null;
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
      if (committed?.id === loaded.id) {
        committed = { ...committed, revision: loaded.revision };
      }
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
button('library-import').onclick = () => showImport();
for (const close of document.querySelectorAll<HTMLButtonElement>('[data-close]')) {
  close.onclick = () => {
    const id = close.dataset.close;
    if (id && !busy) {
      element(id, HTMLDialogElement).close();
    }
  };
}
input('search').oninput = filterPalette;
select('atlas-filter').onchange = filterPalette;
select('kind-filter').onchange = filterPalette;
button('deselect').onclick = () => {
  selection = null;
  selectedObject = null;
  selectedObjects.clear();
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
  selectedObjects.clear();
  draw();
};
for (const control of document.querySelectorAll<HTMLInputElement>('input[name="tool"]')) {
  control.onchange = () => {
    stampBrush = null;
    syncPanCursor();
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
  if (
    editor &&
    !busy &&
    !document.querySelector('dialog[open], [popover]:popover-open') &&
    event.target instanceof HTMLInputElement &&
    ['layer-name', 'search'].includes(event.target.id) &&
    ['Enter', 'Escape'].includes(event.key) &&
    !event.isComposing
  ) {
    event.preventDefault();
    if (event.key === 'Escape' && event.target.id === 'layer-name') {
      event.target.value = editor.active.name;
    }
    canvas.focus({ preventScroll: true });
    return;
  }
  if (!busy && animationPreview.movement.keydown(event)) {
    return;
  }
  if (
    (event.target instanceof Element && event.target.closest('#animation-preview')) ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLTextAreaElement ||
    (event.target instanceof Element &&
      Boolean(event.target.closest('a, [contenteditable]:not([contenteditable="false"])'))) ||
    (event.target instanceof HTMLButtonElement && !event.ctrlKey && !event.metaKey) ||
    document.querySelector('dialog[open], [popover]:popover-open') ||
    busy
  ) {
    return;
  }
  try {
    if (event.key === 'Escape' && definitionBrush) {
      definitionBrush = null;
      draw();
    }
    if (event.key === 'Escape' && stampBrush) {
      event.preventDefault();
      stampBrush = null;
      status.textContent = 'Stamp placement stopped.';
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      ['c', 'x', 'v', 'd'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      const commands: Record<string, Parameters<typeof compositionAction>[0]> = {
        c: 'copy',
        x: 'cut',
        v: 'paste',
        d: 'duplicate',
      };
      compositionAction(commands[event.key.toLowerCase()]);
    } else if (
      (event.ctrlKey || event.metaKey) &&
      ['s', 'z', 'y'].includes(event.key.toLowerCase())
    ) {
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
    } else if (selectedObjects.size && !selection && editor) {
      if (event.key === 'Escape') {
        selectedObjects.clear();
        draw();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        eraseCaptured(editor, compositionSelection());
        selectedObjects.clear();
        draw();
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
        selectedObjects.clear();
      } else if (event.key === 'Escape') {
        selectedObject = null;
        selectedObjects.clear();
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
        eraseCaptured(editor, compositionSelection());
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
          const copied = capture(editor, compositionSelection(), project?.id ?? '');
          const staged = new LayerEditor(editor.scene, [], editor.descriptor);
          staged.spriteRegion = editor.spriteRegion;
          eraseCaptured(staged, compositionSelection());
          paste(
            staged,
            copied.composition,
            project?.id ?? '',
            copied.x + delta[0],
            copied.y + delta[1],
            (asset) => regions.has(asset),
            false,
          );
          editor.change(() => {
            if (editor) {
              editor.scene = staged.scene;
            }
          });
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
  if (project) {
    await showRecovery();
    if (new URLSearchParams(location.search).get('guide') === '1') {
      history.replaceState(null, '', location.pathname);
      firstSceneGuide.continueInProject();
    }
  }
});

// Checkpoint only authored scene snapshots; playback positions and selections are transient.
setInterval(() => {
  checkpoint();
  if (!busy && !anchor) {
    void draftWriter?.flush();
  }
}, 5000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    checkpoint();
    void draftWriter?.flush();
  }
});
function recoverySelection() {
  return recoveryItems.find((item) => item.id === select('recovery-drafts').value);
}
function recoveryLabel(item: Record<string, unknown>) {
  return `${string(item.name)} · ${new Date(string(item.updated)).toLocaleString()}`;
}
function recoveryDetails() {
  const item = recoverySelection();
  element('recovery-details', HTMLElement).textContent = item
    ? `${recoveryLabel(item)}. Restoration checks the original project, scene and asset revisions. If they changed, download the draft to retain its contents.`
    : 'No recoverable drafts. Checkpoints are created automatically while editing.';
  for (const id of ['recovery-restore', 'recovery-download', 'recovery-discard']) {
    button(id).disabled = !item;
  }
}
async function showRecovery(sceneId?: string) {
  const result = await api('list-drafts', record, {});
  const all = array(result.drafts, record);
  recoveryItems = all.filter(
    (item) => !item.error && item.id !== draftWriter?.id && (!sceneId || item.scene_id === sceneId),
  );
  select('recovery-drafts').replaceChildren(
    ...recoveryItems.map((item) => new Option(recoveryLabel(item), string(item.id))),
  );
  recoveryDetails();
  if (all.some((item) => item.error)) {
    element('draft-status', HTMLElement).textContent =
      'Some draft files are damaged. They remain in .forge/drafts for manual recovery.';
  }
  if (recoveryItems.length) {
    element('recovery-dialog', HTMLDialogElement).showModal();
  }
}
select('recovery-drafts').onchange = recoveryDetails;
button('show-recovery').onclick = () =>
  void run(async () => {
    await showRecovery();
    if (!recoveryItems.length) {
      status.textContent = 'No recoverable drafts.';
    }
  });
button('recovery-later').onclick = () => {
  if (!busy) {
    element('recovery-dialog', HTMLDialogElement).close();
  }
};
element('recovery-dialog', HTMLDialogElement).oncancel = (event) => {
  if (busy) {
    event.preventDefault();
  }
};
button('recovery-restore').onclick = () =>
  void run(async () => {
    const item = recoverySelection();
    if (!item || dirty()) {
      return;
    }
    const guard = { id: string(item.id), revision: string(item.revision) };
    // Fetch baseline first; restore validates again after it, fencing concurrent saves.
    const saved = await api(`scene/${string(item.scene_id)}`, decodeLoaded);
    const restored = await api('restore-draft', decodeLoaded, guard);
    if (saved.revision !== restored.revision) {
      throw Error(
        'Scene changed during recovery. Reopen recovery and try again; the draft was retained.',
      );
    }
    await clearDraft();
    await refresh();
    open(restored);
    baseline = JSON.stringify({
      width: saved.width,
      height: saved.height,
      layers: saved.layers,
      nextLayer: saved.nextLayerId,
      next: saved.nextObjectId,
    });
    committed = saved;
    recoveredDraft = guard;
    element('recovery-dialog', HTMLDialogElement).close();
    draw();
    status.textContent =
      'Draft restored as unsaved edits. Save scene to commit them; Revert discards them.';
  });
button('recovery-download').onclick = () =>
  void run(async () => {
    const item = recoverySelection();
    if (!item) {
      return;
    }
    const value = await api('download-draft', record, { id: item.id, revision: item.revision });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `forge-draft-${string(item.id)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = 'Draft downloaded. The checkpoint is still available.';
  });
button('recovery-discard').onclick = () =>
  void run(async () => {
    const item = recoverySelection();
    if (
      !item ||
      !window.confirm(
        `Permanently discard the draft for “${string(item.name)}”? Download it first to keep a copy.`,
      )
    ) {
      return;
    }
    await api('delete-draft', record, { id: item.id, revision: item.revision });
    element('recovery-dialog', HTMLDialogElement).close();
    await showRecovery();
    status.textContent = 'Draft discarded. Saved scenes are unchanged.';
  });

for (const id of ['scene-manage-dialog', 'resize-scene-dialog']) {
  element(id, HTMLDialogElement).oncancel = (event) => {
    if (busy) {
      event.preventDefault();
    }
  };
}
