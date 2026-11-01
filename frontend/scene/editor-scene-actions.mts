import { MAX_SCENE_PIXELS, checkDimensions } from './dimensions.mts';
import { createSceneNavigation, sceneFromPath } from './scene-navigation.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { createAnimationPreview } from '../preview/animation-preview.mts';
import { blockoutAppearance } from '../blockout/blockout.mts';
import { record, string } from '../shared/decode.mts';
import type { DiagnosticLocation } from '../diagnostics/diagnostics-view.mts';
import { button, element, form, input, select } from '../editor/editor-dom.mts';
import type {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from '../editor/editor-state.mts';
import type { LayerScene } from './layers.mts';
import { LayerEditor } from './layers.mts';
import type { ProjectApi } from '../project/project-api.mts';
import type { Loaded, Region } from '../project/project-contracts.mts';
import { decodeLoaded, decodeProject } from '../project/project-contracts.mts';
import { resizeScene } from './scene-size.mts';
import type { Endpoint } from '../world/world.mts';

export interface Ports {
  discard: () => Promise<boolean>;
  run: (work: () => Promise<void> | void) => Promise<void>;
  clearDraft: () => Promise<void>;
  refresh: (
    supplied?: Record<string, unknown>,
    canApply?: () => Promise<boolean>,
  ) => Promise<boolean>;
  showRecovery: (sceneId?: string) => Promise<void>;
  focusWorldEndpoint: () => void;
  focusDiagnostic: () => void;
  pendingWorldEndpoint: Endpoint | null;
  pendingDiagnostic: DiagnosticLocation | null;
  newDraftWriter: () => void;
  draw: (refreshUI?: boolean) => void;
  drawOverview: (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void;
  sprites: ReadonlyMap<string, { image: HTMLImageElement; region: Region }>;
  palette: (chooseInitial?: boolean) => void;
}
export function createSceneActionsController({
  lifetime,
  api,
  workspaceState,
  status,
  sceneSession,
  activity,
  gestures,
  brushes,
  projectBase,
  canvas,
  sceneSelection,
  animationPreview,
  ports,
}: {
  lifetime: EditorLifetime;
  api: ProjectApi['json'];
  workspaceState: Pick<
    WorkspaceState,
    'navigating' | 'pendingProject' | 'project' | 'revision' | 'sceneChoices'
  >;
  status: HTMLElement;
  sceneSession: Pick<
    SceneSession,
    'baseline' | 'committed' | 'dirty' | 'editor' | 'loaded' | 'serialize' | 'snapshot'
  >;
  activity: EditorActivity;
  gestures: Pick<GestureState, 'anchor' | 'blockoutDraw' | 'hover' | 'objectDrag' | 'objectResize'>;
  brushes: Pick<
    BrushState,
    'brush' | 'definitionBrush' | 'objectBrush' | 'spriteBrush' | 'stampBrush'
  >;
  projectBase: string;
  canvas: HTMLCanvasElement;
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  animationPreview: ReturnType<typeof createAnimationPreview>;
  ports: Ports;
}) {
  const navigation = createSceneNavigation(lifetime, projectBase, async (path) => {
    if (activity.busy || gestures.anchor || document.querySelector('dialog[open]')) {
      return false;
    }
    let opened = false;
    await ports.run(async () => {
      const id = sceneFromPath(path, projectBase);
      if (!(await ports.discard()) || lifetime.disposed) {
        return;
      }
      if (id) {
        try {
          await openSavedScene(id);
        } finally {
          opened = sceneSession.loaded?.id === id;
        }
      } else {
        await ports.clearDraft();
        closeScene();
        status.textContent = 'Choose a scene, or import an atlas and create one.';
        opened = true;
      }
    });
    return opened;
  });

  async function openInitialScene() {
    const id = sceneFromPath(location.pathname, projectBase);
    if (id) {
      await openSavedScene(id);
    } else {
      await ports.showRecovery();
    }
  }

  let pendingScene = '';

  let deleteCandidate: {
    id: string;
    name: string;
    revision: string;
    projectRevision: string;
  } | null = null;

  function open(data: Loaded, chooseInitialBrush = true) {
    if (lifetime.disposed) {
      return;
    }
    brushes.stampBrush = null;
    brushes.definitionBrush = null;
    sceneSession.committed = data;
    ports.newDraftWriter();
    sceneSession.loaded = data;
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
    sceneSession.editor = new LayerEditor(scene, [], { erase_cell: 'empty' });
    sceneSession.editor.spriteRegion = (asset) => ports.sprites.get(asset)?.region;
    if (
      data.layers.some(
        (layer) =>
          layer.type === 'objectgroup' &&
          layer.objects.some(
            (item) =>
              blockoutAppearance(item, workspaceState.project?.definitions ?? [])?.role ===
              'camera',
          ),
      )
    ) {
      const geometry = sceneSession.editor.layers.find(
        (layer) =>
          layer.type === 'objectgroup' && layer.name === 'Blockout geometry' && layer.visible,
      );
      if (geometry) {
        sceneSession.editor.activate(geometry.id);
      }
    }
    sceneSession.baseline = sceneSession.snapshot();
    sceneSelection.selection = null;
    sceneSelection.selectedObject = null;
    sceneSelection.selectedObjects.clear();
    gestures.objectDrag = null;
    gestures.blockoutDraw = null;
    gestures.objectResize = null;
    gestures.anchor = null;
    gestures.hover = null;
    element('coordinates', HTMLElement).textContent = 'Cell —, — · Pixel —, —';
    canvas.hidden = false;
    element('canvas-surround', HTMLElement).hidden = false;
    element('empty-scene', HTMLElement).hidden = true;
    select('scenes').value = data.id;
    element('scene-name', HTMLElement).textContent =
      `${data.name} · ${data.width} × ${data.height} · ${data.grid}px`;
    navigation.commit(data.id);
    ports.palette(chooseInitialBrush);
    ports.draw();
  }

  const createDimensions = () => {
    const max = String(MAX_SCENE_PIXELS / Number(select('cell-size').value));
    input('width').max = max;
    input('height').max = max;
  };
  lifetime.assign(select('cell-size'), 'onchange', createDimensions);
  createDimensions();

  lifetime.assign(form('scene-form'), 'onsubmit', async (event) => {
    event.preventDefault();
    if (!(await ports.discard())) {
      return;
    }
    void ports.run(async () => {
      checkDimensions(
        Number(input('width').value),
        Number(input('height').value),
        Number(select('cell-size').value),
      );
      const data = await api('create-scene', decodeLoaded, {
        name: input('scene-title').value,
        width: Number(input('width').value),
        height: Number(input('height').value),
        grid: Number(select('cell-size').value),
        project_revision: workspaceState.revision,
      });
      await ports.clearDraft();
      if (!(await ports.refresh()) || lifetime.disposed) {
        return;
      }
      open(data);
      element('create-scene-dialog', HTMLDialogElement).close();
      status.textContent = 'Scene created. Choose a region and paint.';
    });
  });

  async function openSavedScene(id: string) {
    if (!workspaceState.sceneChoices.some((scene) => scene.id === id)) {
      throw Error('Scene not found. Choose another scene from the scene list.');
    }
    const data = await api(`scene/${encodeURIComponent(id)}`, decodeLoaded);
    await ports.clearDraft();
    if (!(await ports.refresh()) || lifetime.disposed) {
      return;
    }
    open(data);
    status.textContent = 'Scene opened.';
    await ports.showRecovery(id);
    if (lifetime.disposed) {
      return;
    }
    ports.focusWorldEndpoint();
    ports.focusDiagnostic();
  }

  lifetime.assign(select('scenes'), 'onchange', () => {
    const id = select('scenes').value;
    select('scenes').value = sceneSession.loaded?.id || '';
    ports.pendingWorldEndpoint = null;
    ports.pendingDiagnostic = null;
    requestSceneOpen(id);
  });

  function requestSceneOpen(id: string) {
    if (activity.busy || gestures.anchor || !id || id === sceneSession.loaded?.id) {
      return;
    }
    if (sceneSession.dirty()) {
      pendingScene = id;
      const dialog = element('switch-scene-dialog', HTMLDialogElement);
      dialog.querySelector('.form-error')?.replaceChildren();
      const target =
        workspaceState.sceneChoices.find((scene) => scene.id === id)?.name || 'another scene';
      element('switch-scene-description', HTMLElement).textContent =
        `This scene has unsaved changes. Save them before opening “${target}”.`;
      dialog.showModal();
    } else {
      void ports.run(() => openSavedScene(id));
    }
  }

  function confirmSceneSwitch(save: boolean) {
    if (!pendingScene || activity.busy) {
      return;
    }
    void ports.run(async () => {
      if (save) {
        await saveScene();
      }
      await openSavedScene(pendingScene);
      if (lifetime.disposed) {
        return;
      }
      element('switch-scene-dialog', HTMLDialogElement).close();
    });
  }

  lifetime.assign(button('scene-switch-save'), 'onclick', () => confirmSceneSwitch(true));

  lifetime.assign(button('scene-switch-discard'), 'onclick', () => confirmSceneSwitch(false));

  lifetime.assign(button('scene-switch-cancel'), 'onclick', () => {
    if (!activity.busy) {
      element('switch-scene-dialog', HTMLDialogElement).close();
    }
  });

  lifetime.assign(element('switch-scene-dialog', HTMLDialogElement), 'oncancel', (event) => {
    if (activity.busy) {
      event.preventDefault();
    }
  });

  lifetime.assign(element('switch-scene-dialog', HTMLDialogElement), 'onclose', () => {
    // A queued close event may arrive after a new confirmation has already opened.
    if (!element('switch-scene-dialog', HTMLDialogElement).open) {
      pendingScene = '';
      ports.pendingDiagnostic = null;
    }
  });

  async function saveScene() {
    if (!sceneSession.editor || !sceneSession.loaded) {
      return;
    }
    const ids = new Set(
      sceneSession.editor.layers.flatMap((l) =>
        l.type === 'objectgroup' ? l.objects.map((o) => Number(o.id)) : [],
      ),
    );
    const savedIds = new Set(
      sceneSession.committed?.layers.flatMap((l) =>
        l.type === 'objectgroup' ? l.objects.map((o) => Number(o.id)) : [],
      ) ?? [],
    );
    const broken =
      workspaceState.project?.world.connections.filter((link) =>
        [link.source, link.destination].some(
          (e) =>
            e.scene === sceneSession.loaded?.id && savedIds.has(e.object) && !ids.has(e.object),
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
    const result = await api('save-scene', record, {
      id: sceneSession.loaded.id,
      scene: sceneSession.serialize(),
      revision: sceneSession.loaded.revision,
      project_revision: workspaceState.revision,
      confirm_broken_links: broken.length > 0,
    });
    const data = decodeLoaded(result);
    await ports.clearDraft();
    sceneSession.loaded = data;
    brushes.stampBrush = null;
    brushes.definitionBrush = null;
    sceneSession.committed = data;
    sceneSession.baseline = sceneSession.snapshot();
    ports.newDraftWriter();
    // A later writer's manifest must not be acknowledged without adopting it.
    workspaceState.revision = string(result.project_revision);
    status.textContent = 'Scene saved.';
  }

  lifetime.assign(button('save'), 'onclick', () => void ports.run(saveScene));

  function navigateProject() {
    if (lifetime.disposed) {
      return;
    }
    workspaceState.navigating = true;
    location.assign(
      workspaceState.pendingProject === '/' ? '/' : `${workspaceState.pendingProject}/`,
    );
  }

  lifetime.assign(select('switch-project'), 'onchange', () => {
    const destination = select('switch-project').value;
    select('switch-project').value = projectBase;
    if (activity.busy || gestures.anchor || !destination || destination === projectBase) {
      return;
    }
    workspaceState.pendingProject = destination;
    element('switch-project-dialog', HTMLDialogElement)
      .querySelector('.form-error')
      ?.replaceChildren();
    if (sceneSession.dirty()) {
      element('switch-project-dialog', HTMLDialogElement).showModal();
    } else {
      navigateProject();
    }
  });

  lifetime.assign(button('switch-save'), 'onclick', () => {
    void ports.run(async () => {
      await saveScene();
      navigateProject();
    });
  });

  lifetime.assign(button('switch-discard'), 'onclick', () => {
    void ports.run(async () => {
      await ports.clearDraft();
      navigateProject();
    });
  });

  lifetime.assign(button('switch-cancel'), 'onclick', () => {
    if (!activity.busy) {
      element('switch-project-dialog', HTMLDialogElement).close();
    }
  });

  lifetime.assign(element('switch-project-dialog', HTMLDialogElement), 'oncancel', (event) => {
    if (activity.busy) {
      event.preventDefault();
    }
  });

  lifetime.assign(button('undo'), 'onclick', () => {
    sceneSelection.selection = null;
    sceneSession.editor?.undo();
    ports.draw();
  });

  lifetime.assign(button('redo'), 'onclick', () => {
    sceneSelection.selection = null;
    sceneSession.editor?.redo();
    ports.draw();
  });

  lifetime.assign(button('revert'), 'onclick', async () => {
    if (sceneSession.committed && (await ports.discard())) {
      void ports.run(async () => {
        await ports.clearDraft();
        if (sceneSession.committed) {
          open(sceneSession.committed);
        }
      });
    }
  });

  let sceneAction: 'rename' | 'duplicate' = 'rename';

  let manageRevision = '';

  function showSceneManagement(action: 'rename' | 'duplicate') {
    if (!sceneSession.loaded || activity.busy || gestures.anchor) {
      return;
    }
    sceneAction = action;
    manageRevision = workspaceState.revision;
    const duplicate = action === 'duplicate';
    const title = duplicate ? 'Duplicate scene' : 'Rename scene';
    element('scene-manage-heading', HTMLElement).textContent = title;
    button('scene-manage-confirm').textContent = title;
    input('scene-manage-name').value = sceneSession.loaded.name + (duplicate ? ' copy' : '');
    element('duplicate-canvas-field', HTMLElement).hidden = !duplicate || !sceneSession.dirty();
    input('duplicate-canvas').checked = false;
    element('scene-manage-hint', HTMLElement).textContent = duplicate
      ? 'Creates a saved, independent scene sharing this project’s artwork. The source stays open with its edits and history. World positions and connections are not copied. Unchecked copies the saved scene.'
      : 'Updates the project name for this scene immediately, preserving its identity and current edits. Scene Undo does not undo a rename.';
    form('scene-manage-form').querySelector('.form-error')?.replaceChildren();
    element('scene-manage-dialog', HTMLDialogElement).showModal();
    input('scene-manage-name').focus();
    input('scene-manage-name').select();
  }

  lifetime.assign(button('show-rename'), 'onclick', () => showSceneManagement('rename'));

  lifetime.assign(button('show-duplicate-scene'), 'onclick', () =>
    showSceneManagement('duplicate'),
  );

  lifetime.assign(form('scene-manage-form'), 'onsubmit', (event) => {
    event.preventDefault();
    if (!sceneSession.loaded || activity.busy) {
      return;
    }
    const current = sceneSession.loaded;
    const action = sceneAction;
    const title = input('scene-manage-name').value.trim();
    void ports.run(async () => {
      const result = await api(`${action}-scene`, record, {
        id: current.id,
        name: title,
        revision: current.revision,
        project_revision: manageRevision,
        ...(action === 'duplicate' && sceneSession.dirty() && input('duplicate-canvas').checked
          ? { scene: sceneSession.serialize() }
          : {}),
      });
      workspaceState.project = decodeProject(result.project);
      workspaceState.revision = string(result.revision);
      if (action === 'rename') {
        sceneSession.loaded = { ...current, name: title };
        if (sceneSession.committed) {
          sceneSession.committed = { ...sceneSession.committed, name: title };
        }
      }
      element('scene-manage-dialog', HTMLDialogElement).close();
      if (!(await ports.refresh()) || lifetime.disposed) {
        return;
      }
      select('scenes').value = current.id;
      ports.draw();
      status.textContent =
        action === 'rename'
          ? `Renamed scene to “${title}”.`
          : `Created “${title}”. Choose it from the scene list to open it.`;
    });
  });

  function resizeCandidate() {
    if (!sceneSession.editor) {
      throw Error('Open a scene first.');
    }
    return resizeScene(
      sceneSession.editor,
      Number(input('resize-width').value),
      Number(input('resize-height').value),
      select('resize-anchor').value,
    );
  }

  function previewResize() {
    input('resize-confirm-loss').checked = false;
    try {
      const result = resizeCandidate();
      if (!sceneSession.editor) {
        return;
      }
      const old = sceneSession.editor.scene;
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
      ports.drawOverview(
        context,
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

  lifetime.assign(button('show-resize'), 'onclick', () => {
    if (!sceneSession.editor || activity.busy || gestures.anchor) {
      return;
    }
    input('resize-width').max = input('resize-height').max = String(
      MAX_SCENE_PIXELS / sceneSession.editor.scene.grid,
    );
    input('resize-width').value = String(sceneSession.editor.scene.width);
    input('resize-height').value = String(sceneSession.editor.scene.height);
    select('resize-anchor').value = '0,0';
    form('resize-scene-form').querySelector('.form-error')?.replaceChildren();
    previewResize();
    element('resize-scene-dialog', HTMLDialogElement).showModal();
  });

  lifetime.assign(input('resize-width'), 'oninput', previewResize);

  lifetime.assign(input('resize-height'), 'oninput', previewResize);

  lifetime.assign(select('resize-anchor'), 'onchange', previewResize);

  lifetime.assign(form('resize-scene-form'), 'onsubmit', (event) => {
    event.preventDefault();
    if (!sceneSession.editor || activity.busy) {
      return;
    }
    void ports.run(() => {
      const result = resizeCandidate();
      if (
        (result.tiles || result.removed || result.clipped) &&
        !input('resize-confirm-loss').checked
      ) {
        throw Error('Confirm the listed removals and clipping before applying.');
      }
      sceneSession.editor?.change(() => {
        if (sceneSession.editor) {
          sceneSession.editor.scene = result.scene;
        }
      });
      sceneSelection.selection = null;
      sceneSelection.selectedObject = null;
      sceneSelection.selectedObjects.clear();
      gestures.hover = null;
      animationPreview.reset();
      element('resize-scene-dialog', HTMLDialogElement).close();
      ports.draw();
      status.textContent = 'Scene resized. Undo restores it; Save commits it to disk.';
    });
  });

  lifetime.assign(button('show-delete'), 'onclick', () => {
    const id = select('scenes').value;
    if (!id || activity.busy) {
      return;
    }
    void ports.run(async () => {
      const scene =
        sceneSession.loaded?.id === id
          ? sceneSession.loaded
          : await api(`scene/${id}`, decodeLoaded);
      deleteCandidate = {
        id,
        name: scene.name,
        revision: scene.revision,
        projectRevision: workspaceState.revision,
      };
      element('delete-scene-description', HTMLElement).textContent =
        `Delete “${scene.name}” (${scene.width} × ${scene.height} cells, ${scene.grid}px grid)?`;
      const links =
        workspaceState.project?.world.connections.filter(
          (l) => l.source.scene === id || l.destination.scene === id,
        ) ?? [];
      element('delete-scene-links', HTMLElement).textContent = links.length
        ? `This breaks ${links.length} connection(s): ${links.map((l) => l.name).join(', ')}. Connections will be retained for repair in World view. Deleting confirms these broken links.`
        : '';
      element('delete-scene-unsaved', HTMLElement).hidden =
        sceneSession.loaded?.id !== id || !sceneSession.dirty();
      form('delete-scene-form').querySelector('.form-error')?.replaceChildren();
      element('delete-scene-dialog', HTMLDialogElement).showModal();
    });
  });

  lifetime.assign(form('delete-scene-form'), 'onsubmit', (event) => {
    event.preventDefault();
    const candidate = deleteCandidate;
    if (!candidate || activity.busy) {
      return;
    }
    void ports.run(async () => {
      const result = await api('delete-scene', record, {
        id: candidate.id,
        revision: candidate.revision,
        project_revision: candidate.projectRevision,
        confirm_broken_links: true,
      });
      if (string(result.deleted) !== candidate.id) {
        throw Error('Unexpected deleted scene response');
      }
      workspaceState.project = decodeProject(result.project);
      workspaceState.revision = string(result.revision);
      if (sceneSession.loaded?.id === candidate.id) {
        await ports.clearDraft();
        closeScene();
      }
      element('delete-scene-dialog', HTMLDialogElement).close();
      deleteCandidate = null;
      if (!(await ports.refresh()) || lifetime.disposed) {
        return;
      }
      if (sceneSession.loaded) {
        select('scenes').value = sceneSession.loaded.id;
        ports.draw();
      }
      status.textContent = `Deleted “${candidate.name}”.`;
    });
  });

  function closeScene() {
    sceneSession.loaded = null;
    sceneSession.editor = null;
    sceneSession.baseline = '';
    sceneSelection.selection = null;
    sceneSelection.selectedObject = null;
    sceneSelection.selectedObjects.clear();
    gestures.objectDrag = null;
    gestures.blockoutDraw = null;
    gestures.objectResize = null;
    gestures.anchor = null;
    gestures.hover = null;
    brushes.brush = null;
    brushes.spriteBrush = null;
    brushes.definitionBrush = null;
    brushes.objectBrush = null;
    brushes.stampBrush = null;
    canvas.hidden = true;
    element('canvas-surround', HTMLElement).hidden = true;
    element('empty-scene', HTMLElement).hidden = false;
    element('scene-name', HTMLElement).textContent = 'No scene open';
    element('coordinates', HTMLElement).textContent = 'Cell —, — · Pixel —, —';
    element('selected-brush', HTMLElement).textContent = 'Select a brush';
    sceneSession.committed = null;
    animationPreview.reset();
    select('scenes').value = '';
    navigation.commit(null);
    ports.draw();
  }

  function showCreate() {
    if (activity.busy) {
      return;
    }
    form('scene-form').querySelector('.form-error')?.replaceChildren();
    element('create-scene-dialog', HTMLDialogElement).showModal();
  }

  lifetime.assign(button('show-create'), 'onclick', showCreate);

  lifetime.assign(button('empty-create'), 'onclick', showCreate);
  return {
    requestSceneOpen,
    openInitialScene,
    closeScene,
    open,
    get deleteCandidate() {
      return deleteCandidate;
    },
    set deleteCandidate(
      value: { id: string; name: string; revision: string; projectRevision: string } | null,
    ) {
      deleteCandidate = value;
    },
  };
}
