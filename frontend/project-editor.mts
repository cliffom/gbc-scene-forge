import { EditorLifetime } from './editor-lifetime.mts';
import { createArtworkController } from './editor-artwork.mts';
import { createCommandsController } from './editor-commands.mts';
import { createCompositionsController } from './editor-compositions.mts';
import { button, element, input, select } from './editor-dom.mts';
import { createGesturesController } from './editor-gestures.mts';
import { createLayersController } from './editor-layers.mts';
import { createPanelsController } from './editor-panels.mts';
import { createRecoveryController } from './editor-recovery.mts';
import { createRefreshController } from './editor-refresh.mts';
import { createRenderingController } from './editor-rendering.mts';
import { createSceneActionsController } from './editor-scene-actions.mts';
import {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';
import { createViewportController } from './editor-viewport.mts';
import { createWorkspaceController } from './editor-workspace.mts';
import { ProjectApi } from './project-api.mts';
import { decodeProject } from './project-contracts.mts';
import { createAnimationPreview } from './animation-preview.mts';
import { createBlockoutLabels } from './blockout-labels.mts';
import { blockoutDefinitions } from './blockout.mts';
import { boolean, number, record, string } from './decode.mts';
import { createEditorLayout } from './editor-layout.mts';
import { createFirstSceneGuide } from './first-scene-guide.mts';
import { prunePreviewSettings } from './preview-settings.mts';

declare const __FORGE_BUILD_LABEL__: string;

/** Compose one independent editor; imports have no DOM or timer side effects. */
export function mountProjectEditor() {
  const versionLabel = document.getElementById('app-version');
  if (versionLabel) {
    versionLabel.textContent = __FORGE_BUILD_LABEL__;
  }
  const lifetime = new EditorLifetime();
  const workspaceState = new WorkspaceState();
  const sceneSession = new SceneSession();
  const sceneSelection = new SceneSelection();
  const brushes = new BrushState();
  const gestures = new GestureState();
  const activity = new EditorActivity();
  const editorLayout = createEditorLayout(lifetime);
  const canvas = element('scene', HTMLCanvasElement);
  const blockoutLabels = createBlockoutLabels(canvas, element('viewport', HTMLElement), lifetime);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw Error('Canvas rendering is unavailable');
  }
  const context = ctx;
  const status = element('status', HTMLElement);
  const projectMatch = /^\/projects\/([^/]+)\//.exec(location.pathname);
  const projectBase = projectMatch ? `/projects/${projectMatch[1]}` : '';
  const transport = new ProjectApi(projectBase, lifetime.signal);
  const api = transport.json.bind(transport);
  const request = transport.request.bind(transport);
  const animationPreview = createAnimationPreview(() => renderingController.draw(false), lifetime);
  async function discard(): Promise<boolean> {
    if (!sceneSession.dirty()) {
      return true;
    }
    const dialog = element('discard-dialog', HTMLDialogElement);
    if (dialog.open) {
      return false;
    }
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'discard'), {
        ...{
          once: true,
        },
        signal: lifetime.signal,
      });
      dialog.returnValue = '';
      dialog.showModal();
    });
  }
  function update() {
    if (lifetime.disposed) {
      return;
    }
    panelsController.renderObjectValidation();
    editorLayout.enableBlockout(
      blockoutDefinitions(workspaceState.project?.definitions ?? []).length > 0,
    );
    panelsController.blockoutView.sync();
    for (const node of element('blockout-presets', HTMLElement).querySelectorAll('button')) {
      node.setAttribute(
        'aria-pressed',
        String(node.dataset.definition === brushes.definitionBrush),
      );
      node.disabled = activity.busy || !sceneSession.editor || gestures.anchor !== null;
    }
    button('show-first-scene-guide').disabled = activity.busy || gestures.anchor !== null;
    for (const id of ['scene-commands', 'project-commands']) {
      button(id).disabled = activity.busy || !workspaceState.project || gestures.anchor !== null;
    }
    button('show-world').disabled =
      activity.busy || !workspaceState.project || gestures.anchor !== null;
    button('show-diagnostics').disabled =
      activity.busy || !workspaceState.project || gestures.anchor !== null;
    button('manage-definitions').disabled =
      activity.busy || !workspaceState.project || gestures.anchor !== null;
    button('place-definition').disabled =
      activity.busy ||
      !sceneSession.editor ||
      !select('object-definition-brush').value ||
      gestures.anchor !== null;
    select('object-definition-brush').disabled = activity.busy || !workspaceState.project;
    recoveryController.checkpoint();
    button('show-recovery').disabled =
      activity.busy || gestures.anchor !== null || sceneSession.dirty();
    panelsController.palettePanel.sync(
      workspaceState.project?.paletteProfile ?? null,
      activity.busy || gestures.anchor !== null,
    );
    if (activity.busy || !sceneSession.editor) {
      gestures.spacePan = false;
      gesturesController.finishPan();
    }
    gesturesController.syncPanCursor();
    select('switch-project').disabled = activity.busy || gestures.anchor !== null || !projectBase;
    button('show-new-project').disabled = button('back-to-projects').disabled = activity.busy;
    for (const id of ['switch-save', 'switch-discard', 'switch-cancel']) {
      button(id).disabled = activity.busy;
    }
    for (const id of ['scene-switch-save', 'scene-switch-discard', 'scene-switch-cancel']) {
      button(id).disabled = activity.busy;
    }
    element('dirty', HTMLElement).textContent = !sceneSession.editor
      ? 'NO SCENE'
      : sceneSession.dirty()
        ? 'UNSAVED'
        : 'SAVED';
    element('dirty', HTMLElement).dataset.dirty = String(sceneSession.dirty());
    button('save-preview-settings').disabled = activity.busy || !workspaceState.project;
    const unsaved = Boolean(sceneSession.editor && sceneSession.dirty());
    button('save').disabled = activity.busy || !unsaved;
    button('save').classList.toggle('primary', unsaved);
    const saveState = element('scene-save-state', HTMLElement);
    const saveText = !sceneSession.editor ? '' : unsaved ? 'Unsaved changes' : 'Saved';
    if (saveState.textContent !== saveText) {
      saveState.textContent = saveText;
    }
    saveState.dataset.dirty = String(unsaved);
    button('fit-scene').disabled = !sceneSession.editor;
    select('zoom').disabled = !sceneSession.editor;
    button('library-import').disabled = activity.busy || gestures.anchor !== null;
    button('show-export').disabled =
      activity.busy || !workspaceState.project || gestures.anchor !== null;
    button('show-palettes').disabled =
      activity.busy || !workspaceState.project || gestures.anchor !== null;
    button('export-confirm').disabled = button('export-cancel').disabled = activity.busy;
    select('export-scope').disabled = activity.busy;
    input('export-canvas').disabled =
      activity.busy || !sceneSession.editor || !sceneSession.dirty();
    button('undo').disabled = activity.busy || !sceneSession.editor?.undoStack.length;
    button('redo').disabled = activity.busy || !sceneSession.editor?.redoStack.length;
    button('revert').disabled = activity.busy || !sceneSession.dirty();
    const hasComposition = Boolean(
      sceneSelection.selection ||
      sceneSelection.selectedObject ||
      sceneSelection.selectedObjects.size,
    );
    button('transform-commands').disabled =
      activity.busy || !sceneSession.editor || !hasComposition || gestures.anchor !== null;
    for (const id of [
      'copy-selection',
      'cut-selection',
      'duplicate-selection',
      'flip-horizontal',
      'flip-vertical',
      'rotate-selection',
      'save-stamp',
    ]) {
      button(id).disabled =
        activity.busy || !sceneSession.editor || !hasComposition || gestures.anchor !== null;
    }
    button('paste-selection').disabled =
      activity.busy || !sceneSession.editor || !brushes.clipboard || gestures.anchor !== null;
    button('place-stamp').disabled =
      activity.busy || !sceneSession.editor || !select('stamps').value;
    button('place-stamp').setAttribute('aria-pressed', String(brushes.stampBrush !== null));
    button('place-stamp').textContent = brushes.stampBrush ? 'Stop placing' : 'Place stamp';
    select('stamps').title = select('stamps').selectedOptions[0]?.textContent ?? '';
    select('stamps').disabled = activity.busy || !workspaceState.project?.stamps.length;
    button('delete-stamp').disabled = activity.busy || !select('stamps').value;
    input('select-all-layers').disabled =
      activity.busy || !sceneSession.editor || gestures.anchor !== null;
    button('deselect').disabled =
      activity.busy ||
      (!sceneSelection.selection &&
        !sceneSelection.selectedObject &&
        !sceneSelection.selectedObjects.size);
    button('edit-tile').disabled =
      activity.busy ||
      !sceneSession.loaded ||
      (!brushes.brush && !brushes.spriteBrush) ||
      gestures.anchor !== null;
    button('edit-object').disabled =
      activity.busy ||
      !sceneSession.editor ||
      !sceneSelection.selectedObject ||
      !sceneSession.editor.objects.some((item) => item.id === sceneSelection.selectedObject);
    for (const kind of ['point', 'rectangle']) {
      button(`place-${kind}`).setAttribute('aria-pressed', String(brushes.objectBrush === kind));
    }
    button('place-point').disabled = button('place-rectangle').disabled =
      activity.busy || !sceneSession.editor || gestures.anchor !== null;
    button('remove-sprite').disabled =
      activity.busy ||
      !sceneSelection.selectedObject ||
      !sceneSession.editor?.objects.some((r) => r.id === sceneSelection.selectedObject);
    for (const id of ['paint', 'erase', 'fill', 'select', 'pan']) {
      const control = document.querySelector<HTMLInputElement>(`input[value="${id}"]`);
      if (control) {
        control.disabled =
          activity.busy ||
          !sceneSession.editor ||
          (id === 'fill' &&
            (brushes.definitionBrush !== null ||
              brushes.spriteBrush !== null ||
              brushes.objectBrush !== null ||
              sceneSession.editor?.active.type !== 'tilelayer'));
      }
    }
    for (const control of document.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement
    >('#project-form button, #import-form button, #scene-form button')) {
      control.disabled = activity.busy;
    }
    select('scenes').disabled =
      activity.busy || gestures.anchor !== null || !workspaceState.project?.scenes.length;
    for (const id of ['show-rename', 'show-duplicate-scene', 'show-resize']) {
      button(id).disabled = activity.busy || !sceneSession.editor || gestures.anchor !== null;
    }
    button('scene-manage-confirm').disabled = activity.busy;
    button('resize-confirm').disabled = activity.busy;
    button('show-delete').disabled = activity.busy || !select('scenes').value;
    button('delete-scene-confirm').disabled =
      activity.busy || !sceneActionsController.deleteCandidate;
    button('delete-scene-cancel').disabled = activity.busy;
    button('delete-atlas-confirm').disabled =
      activity.busy ||
      !artworkController.deleteAtlasCandidate ||
      Boolean(
        sceneSession.editor &&
        artworkController.deleteAtlasCandidate &&
        artworkController.usesAtlas(
          sceneSession.editor.scene,
          artworkController.deleteAtlasCandidate.id,
        ),
      );
    button('delete-atlas-cancel').disabled = activity.busy;
    element('atlas-list', HTMLElement)
      .querySelectorAll('button')
      .forEach((button) => {
        button.disabled = activity.busy;
      });
    layersController.renderLayers();
    layersController.renderLayerContext();
    layersController.inspect();
  }
  async function run(work: () => Promise<void> | void) {
    if (lifetime.disposed) {
      return;
    }
    const wasDirty = sceneSession.dirty();
    if (activity.busy) {
      return;
    }
    activity.busy = true;
    status.dataset.state = '';
    document.querySelectorAll('.form-error').forEach((item) => {
      item.textContent = '';
    });
    update();
    try {
      await work();
    } catch (error) {
      if (lifetime.disposed) {
        return;
      }
      status.textContent = error instanceof Error ? error.message : String(error);
      status.dataset.state = 'error';
      const errorField =
        document.querySelector('dialog[open] .form-error') ||
        (!workspaceState.project && document.querySelector('#project-form .form-error'));
      if (errorField) {
        errorField.textContent = status.textContent;
      }
    } finally {
      activity.busy = false;
      update();
      if (!lifetime.disposed && wasDirty && !sceneSession.dirty()) {
        void refreshController.checkExternalChanges();
      }
    }
  }
  const firstSceneGuide = createFirstSceneGuide(
    () => !activity.busy,
    editorLayout.reveal,
    lifetime,
  );
  lifetime.assign(button('save-preview-settings'), 'onclick', () => {
    if (!workspaceState.project || activity.busy) {
      return;
    }
    void run(async () => {
      const available: Record<string, string[]> = {};
      for (const [atlasId, atlas] of Object.entries(workspaceState.project?.atlases || {})) {
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
        project_revision: workspaceState.revision,
      });
      workspaceState.project = decodeProject(result.project);
      workspaceState.revision = string(result.revision);
      status.textContent =
        'Preview settings saved. Scene edits and starting positions are unchanged.';
    });
  });

  const compositionsController = createCompositionsController({
    lifetime,
    sceneSelection,
    sceneSession,
    workspaceState,
    activity,
    gestures,
    animationPreview,
    brushes,
    status,
    api,
    editorLayout,
    canvas,
    ports: {
      get regions() {
        return artworkController.regions;
      },
      draw: (...args) => renderingController.draw(...args),

      update: (...args) => update(...args),
      run: (...args) => run(...args),
      refresh: (...args) => workspaceController.refresh(...args),
    },
  });

  const panelsController = createPanelsController({
    lifetime,
    sceneSession,
    workspaceState,
    api,
    status,
    activity,
    gestures,
    sceneSelection,
    canvas,
    brushes,
    editorLayout,
    ports: {
      run: (...args) => run(...args),

      draw: (...args) => renderingController.draw(...args),
      sceneZoom: (...args) => viewportController.sceneZoom(...args),
      tileMetadata: (...args) => artworkController.tileMetadata(...args),
      update: (...args) => update(...args),

      get sprites() {
        return artworkController.sprites;
      },
      get regions() {
        return artworkController.regions;
      },
      layerAction: (...args) => layersController.layerAction(...args),
      syncPanCursor: (...args) => gesturesController.syncPanCursor(...args),
      requestSceneOpen: (...args) => sceneActionsController.requestSceneOpen(...args),

      filterPalette: (...args) => artworkController.filterPalette(...args),
      get viewport() {
        return gesturesController.viewport;
      },
      discard: (...args) => discard(...args),
      clearDraft: (...args) => recoveryController.clearDraft(...args),
      refresh: (...args) => workspaceController.refresh(...args),
      open: (...args) => sceneActionsController.open(...args),
      fitScene: (...args) => viewportController.fitScene(...args),
    },
  });

  const layersController = createLayersController({
    lifetime,
    activity,
    sceneSession,
    gestures,
    sceneSelection,
    status,
    brushes,
    workspaceState,
    animationPreview,
    canvas,
    ports: {
      draw: (...args) => renderingController.draw(...args),

      get sprites() {
        return artworkController.sprites;
      },
      previewBlocked: (...args) => renderingController.previewBlocked(...args),
    },
  });

  const workspaceController = createWorkspaceController({
    lifetime,
    workspaceState,
    api,
    projectBase,
    request,
    transport,
    animationPreview,
    status,
    editorLayout,
    firstSceneGuide,
    ports: {
      image: (...args) => artworkController.image(...args),
      replaceImages: (...args) => artworkController.replaceImages(...args),

      showImport: (...args) => artworkController.showImport(...args),
      showDeleteAtlas: (...args) => artworkController.showDeleteAtlas(...args),
      palette: (...args) => artworkController.palette(...args),
      run: (...args) => run(...args),
      get blockoutView() {
        return panelsController.blockoutView;
      },
    },
  });

  const artworkController = createArtworkController({
    lifetime,
    workspaceState,
    sceneSession,
    brushes,
    activity,
    editorLayout,
    sceneSelection,
    status,
    api,
    ports: {
      syncPanCursor: (...args) => gesturesController.syncPanCursor(...args),
      draw: (...args) => renderingController.draw(...args),

      discard: (...args) => discard(...args),
      run: (...args) => run(...args),
      clearDraft: (...args) => recoveryController.clearDraft(...args),
      refresh: (...args) => workspaceController.refresh(...args),
      open: (...args) => sceneActionsController.open(...args),

      update: (...args) => update(...args),
    },
  });

  const renderingController = createRenderingController({
    lifetime,
    sceneSession,
    sceneSelection,
    canvas,
    brushes,
    context,
    animationPreview,
    workspaceState,
    blockoutLabels,
    gestures,
    ports: {
      tileMetadata: (...args) => artworkController.tileMetadata(...args),

      syncBlockoutZoom: (...args) => viewportController.syncBlockoutZoom(...args),
      sceneZoom: (...args) => viewportController.sceneZoom(...args),
      update: (...args) => update(...args),
      get regions() {
        return artworkController.regions;
      },
      get sprites() {
        return artworkController.sprites;
      },
    },
  });

  const gesturesController = createGesturesController({
    lifetime,
    sceneSession,
    activity,
    gestures,
    canvas,
    sceneSelection,
    brushes,
    status,
    workspaceState,
    animationPreview,
    ports: {
      point: (...args) => renderingController.point(...args),

      draw: (...args) => renderingController.draw(...args),
      spritePosition: (...args) => renderingController.spritePosition(...args),
      hitObject: (...args) => renderingController.hitObject(...args),

      sceneZoom: (...args) => viewportController.sceneZoom(...args),
      get regions() {
        return artworkController.regions;
      },
      trackHover: (...args) => renderingController.trackHover(...args),
      update: (...args) => update(...args),
    },
  });

  const viewportController = createViewportController({
    lifetime,
    sceneSession,
    workspaceState,
    brushes,
    activity,
    gestures,
    canvas,
    ports: {
      draw: (...args) => renderingController.draw(...args),

      get viewport() {
        return gesturesController.viewport;
      },
      trackHover: (...args) => renderingController.trackHover(...args),
    },
  });

  const sceneActionsController = createSceneActionsController({
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
    ports: {
      discard: (...args) => discard(...args),
      run: (...args) => run(...args),

      clearDraft: (...args) => recoveryController.clearDraft(...args),
      refresh: (...args) => workspaceController.refresh(...args),

      showRecovery: (...args) => recoveryController.showRecovery(...args),
      focusWorldEndpoint: (...args) => panelsController.focusWorldEndpoint(...args),
      focusDiagnostic: (...args) => panelsController.focusDiagnostic(...args),
      get pendingWorldEndpoint() {
        return panelsController.pendingWorldEndpoint;
      },
      set pendingWorldEndpoint(value) {
        panelsController.pendingWorldEndpoint = value;
      },
      get pendingDiagnostic() {
        return panelsController.pendingDiagnostic;
      },
      set pendingDiagnostic(value) {
        panelsController.pendingDiagnostic = value;
      },

      newDraftWriter: (...args) => recoveryController.newDraftWriter(...args),
      draw: (...args) => renderingController.draw(...args),
      get sprites() {
        return artworkController.sprites;
      },
      palette: (...args) => artworkController.palette(...args),
    },
  });

  const recoveryController = createRecoveryController({
    lifetime,
    api,
    activity,
    gestures,
    workspaceState,
    sceneSession,
    status,
    ports: {
      run: (...args) => run(...args),
      refresh: (...args) => workspaceController.refresh(...args),
      open: (...args) => sceneActionsController.open(...args),
      draw: (...args) => renderingController.draw(...args),
    },
  });

  const refreshController = createRefreshController({
    lifetime,
    workspaceState,
    activity,
    sceneSession,
    gestures,
    animationPreview,
    api,
    status,
    sceneSelection,
    canvas,
    ports: {
      captureBrush: (...args) => artworkController.captureBrush(...args),
      refresh: (...args) => workspaceController.refresh(...args),
      open: (...args) => sceneActionsController.open(...args),
      restoreBrush: (...args) => artworkController.restoreBrush(...args),
      draw: (...args) => renderingController.draw(...args),

      update: (...args) => update(...args),
    },
  });

  createCommandsController({
    lifetime,
    workspaceState,
    sceneSession,
    activity,
    gestures,
    status,
    request,
    sceneSelection,
    brushes,
    canvas,
    animationPreview,
    ports: {
      run: (...args) => run(...args),
      showImport: (...args) => artworkController.showImport(...args),
      filterPalette: (...args) => artworkController.filterPalette(...args),
      draw: (...args) => renderingController.draw(...args),
      syncPanCursor: (...args) => gesturesController.syncPanCursor(...args),
      compositionAction: (...args) => compositionsController.compositionAction(...args),
      compositionSelection: (...args) => compositionsController.compositionSelection(...args),
      get regions() {
        return artworkController.regions;
      },
    },
  });
  // Import boolean decoding here too: reject malformed preview defaults before first render.
  void run(async () => {
    await workspaceController.refresh();
    if (workspaceState.project) {
      const data = await api('project', record);
      const preview = record(record(data.project).preview);
      input('grid').checked = boolean(preview.grid);
      select('zoom').value = String(number(preview.zoom));
    }
    status.textContent = workspaceState.project
      ? 'Choose a scene, or import an atlas and create one.'
      : workspaceState.choosingProject
        ? 'Choose a project or create a new one.'
        : 'Name your project to get started.';
    if (workspaceState.project) {
      await recoveryController.showRecovery();
      if (new URLSearchParams(location.search).get('blockout') === '1') {
        history.replaceState(null, '', location.pathname);
        editorLayout.showLibrary('blockout');
        panelsController.blockoutView.showCreate();
      } else if (new URLSearchParams(location.search).get('guide') === '1') {
        history.replaceState(null, '', location.pathname);
        firstSceneGuide.continueInProject();
      }
    }
  });

  for (const id of ['scene-manage-dialog', 'resize-scene-dialog']) {
    lifetime.assign(element(id, HTMLDialogElement), 'oncancel', (event) => {
      if (activity.busy) {
        event.preventDefault();
      }
    });
  }

  lifetime.cleanup(() => {
    sceneSession.editor?.cancel();
    gesturesController.finishPan();
    animationPreview.reset();
  });
  return { dispose: () => lifetime.dispose() };
}
