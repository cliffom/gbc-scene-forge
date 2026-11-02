import type { EditorLifetime } from './editor-lifetime.mts';
import { createBlockoutView } from '../blockout/blockout-view.mts';
import { blockoutAppearance, blockoutLayer, definitionRole } from '../blockout/blockout.mts';
import { number, record, string } from '../shared/decode.mts';
import { createDefinitionLibrary } from '../objects/definition-library.mts';
import type { DiagnosticLocation } from '../diagnostics/diagnostics-view.mts';
import { createDiagnosticsView } from '../diagnostics/diagnostics-view.mts';
import { button, element, input, select } from './editor-dom.mts';
import type { createEditorLayout } from './editor-layout.mts';
import type {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';
import type { LayerEditor } from '../scene/layers.mts';
import { describeFinding, resolveDefinition } from '../objects/object-definitions.mts';
import { createObjectInspector } from '../objects/object-inspector.mts';
import { createPalettePanel } from '../diagnostics/palette-budget.mts';
import type { ProjectApi } from '../project/project-api.mts';
import type { Loaded, Region } from '../project/project-contracts.mts';
import { decodeLoaded, decodeProject } from '../project/project-contracts.mts';
import type { TileChoice } from '../artwork/tile-inspector.mts';
import { createTileInspector } from '../artwork/tile-inspector.mts';
import type { TileMetadata } from '../artwork/tile-metadata.mts';
import { createWorldView } from '../world/world-view.mts';
import type { Endpoint } from '../world/world.mts';
import { decodeWorld, decodeWorldSnapshot } from '../world/world.mts';

export interface Ports {
  run: (work: () => Promise<void> | void) => Promise<void>;
  draw: (refreshUI?: boolean) => void;
  sceneZoom: () => number;
  tileMetadata: (group: string, asset: string) => TileMetadata | undefined;
  update: () => void;
  sprites: ReadonlyMap<string, { image: HTMLImageElement; region: Region }>;
  regions: ReadonlyMap<string, { image: HTMLImageElement; x: number; y: number }>;
  layerAction: (work: (editor: LayerEditor) => void, clearSelection?: boolean) => void;
  syncPanCursor: () => void;
  requestSceneOpen: (id: string) => void;
  filterPalette: () => void;
  viewport: HTMLElement;
  discard: () => Promise<boolean>;
  clearDraft: () => Promise<void>;
  refresh: (
    supplied?: Record<string, unknown>,
    canApply?: () => Promise<boolean>,
  ) => Promise<boolean>;
  open: (data: Loaded, chooseInitialBrush?: boolean) => void;
  fitScene: () => void;
}
export function createPanelsController({
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
  ports,
}: {
  lifetime: EditorLifetime;
  sceneSession: Pick<SceneSession, 'editor' | 'loaded' | 'serialize'>;
  workspaceState: Pick<WorkspaceState, 'project' | 'revision'>;
  api: ProjectApi['json'];
  status: HTMLElement;
  activity: EditorActivity;
  gestures: Pick<GestureState, 'anchor'>;
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  canvas: HTMLCanvasElement;
  brushes: Pick<
    BrushState,
    'brush' | 'definitionBrush' | 'objectBrush' | 'spriteBrush' | 'stampBrush'
  >;
  editorLayout: ReturnType<typeof createEditorLayout>;
  ports: Ports;
}) {
  const palettePanel = createPalettePanel(
    {
      context: () => {
        if (!sceneSession.editor || !sceneSession.loaded || !workspaceState.project) {
          return null;
        }
        const payload = {
          scene_id: sceneSession.loaded.id,
          scene_revision: sceneSession.loaded.revision,
          project_revision: workspaceState.revision,
          scene: sceneSession.serialize(),
        };
        return { payload, key: JSON.stringify(payload) };
      },
      report: (preflight, payload) =>
        api(preflight ? 'palette-preflight' : 'palette-report', record, payload),
      save: (profile) => {
        void ports.run(async () => {
          const result = await api('save-palette-profile', record, {
            profile,
            project_revision: workspaceState.revision,
          });
          workspaceState.revision = string(result.revision);
          workspaceState.project = decodeProject(result.project);
          palettePanel.saved();
          status.textContent = 'GBC palette profile saved. Scene content is unchanged.';
        });
      },
      navigate: (source) => {
        if (
          !sceneSession.editor ||
          !sceneSession.loaded ||
          activity.busy ||
          gestures.anchor !== null
        ) {
          return;
        }
        const layer = sceneSession.editor.layers.find(
          (layer) => layer.id === number(source.layer_id),
        );
        if (!layer) {
          return;
        }
        sceneSession.editor.activate(layer.id);
        sceneSelection.selectedObject =
          source.object_id === null ? null : String(number(source.object_id));
        sceneSelection.selection =
          source.object_id === null
            ? { x: number(source.x), y: number(source.y), w: 1, h: 1 }
            : null;
        element('palette-dialog', HTMLDialogElement).close();
        ports.draw();
        const viewport = element('viewport', HTMLElement);
        const sceneRect = canvas.getBoundingClientRect();
        const viewRect = viewport.getBoundingClientRect();
        const multiplier = source.object_id === null ? sceneSession.loaded.grid : 1;
        viewport.scrollLeft +=
          sceneRect.left +
          number(source.x) * multiplier * ports.sceneZoom() -
          viewRect.left -
          viewport.clientWidth / 2;
        viewport.scrollTop +=
          sceneRect.top +
          number(source.y) * multiplier * ports.sceneZoom() -
          viewRect.top -
          viewport.clientHeight / 2;
        status.textContent = layer.visible
          ? `Palette contributor: ${layer.name} · ${string(source.asset)}`
          : `Palette contributor is on hidden layer “${layer.name}”. Show that layer to inspect it on the canvas.`;
        canvas.focus({ preventScroll: true });
      },
    },
    lifetime,
  );

  const tileInspector = createTileInspector(
    (tile) => ports.tileMetadata(tile.group, tile.asset),
    async (tile, metadata) => {
      if (activity.busy) {
        throw Error('Finish the current operation before saving tile metadata.');
      }
      activity.busy = true;
      ports.update();
      try {
        const result = await api('save-tile-metadata', record, {
          atlas: tile.atlas,
          group: tile.group,
          asset: tile.asset,
          metadata,
          project_revision: workspaceState.revision,
        });
        workspaceState.project = decodeProject(result.project);
        workspaceState.revision = string(result.revision);
        ports.draw();
        status.textContent =
          'Tile metadata saved. Shared instances use the new terrain and collision.';
      } finally {
        activity.busy = false;
        ports.update();
      }
    },
    lifetime,
  );

  lifetime.assign(button('edit-tile'), 'onclick', () => {
    if (!sceneSession.loaded || activity.busy) {
      return;
    }
    const choices: TileChoice[] = [];
    if (brushes.spriteBrush) {
      const sprite = ports.sprites.get(brushes.spriteBrush);
      if (sprite) {
        choices.push({
          atlas: brushes.spriteBrush.split('/')[0],
          group: 'sprites',
          asset: brushes.spriteBrush,
          image: sprite.image,
          sx: sprite.region.x,
          sy: sprite.region.y,
          width: sprite.region.width,
          height: sprite.region.height,
        });
      }
    } else if (brushes.brush) {
      for (const asset of brushes.brush.flat()) {
        const region = ports.regions.get(asset);
        if (region) {
          choices.push({
            atlas: asset.split('/')[0],
            group: String(sceneSession.loaded.grid),
            asset,
            image: region.image,
            sx: region.x,
            sy: region.y,
            width: sceneSession.loaded.grid,
            height: sceneSession.loaded.grid,
          });
        }
      }
    }
    tileInspector.open(choices);
  });

  const objectInspector = createObjectInspector(
    () => {
      const item = sceneSession.editor?.objects.find(
        (item) => item.id === sceneSelection.selectedObject,
      );
      return sceneSession.editor && item ? { editor: sceneSession.editor, item } : null;
    },
    ports.draw,
    () => workspaceState.project?.definitions ?? [],
    lifetime,
  );

  lifetime.assign(button('edit-object'), 'onclick', objectInspector.open);

  for (const kind of ['point', 'rectangle'] as const) {
    lifetime.assign(button(`place-${kind}`), 'onclick', () => {
      if (!sceneSession.editor || activity.busy) {
        return;
      }
      const layer =
        sceneSession.editor.active.type === 'objectgroup'
          ? sceneSession.editor.active
          : sceneSession.editor.layers.find(
              (layer) => layer.visible && layer.type === 'objectgroup',
            );
      if (!layer) {
        status.textContent = 'Add an object layer before placing objects.';
        return;
      }
      ports.layerAction((editor) => editor.activate(layer.id));
      brushes.definitionBrush = null;
      brushes.objectBrush = kind;
      brushes.brush = null;
      brushes.spriteBrush = null;
      element('palette', HTMLElement)
        .querySelectorAll('button')
        .forEach((button) => button.setAttribute('aria-pressed', 'false'));
      const paintTool = document.querySelector<HTMLInputElement>('input[value="paint"]');
      if (paintTool) {
        paintTool.checked = true;
      }
      ports.syncPanCursor();
      element('paint-label', HTMLElement).textContent = 'Place object';
      element('selected-brush', HTMLElement).textContent =
        kind === 'point' ? 'Spawn point' : 'Trigger area';
      status.textContent =
        'Click to place an object. Select it to edit its name, class, dimensions and properties.';
      ports.draw();
    });
  }

  async function definitionMutation(route: string, payload: Record<string, unknown>) {
    if (activity.busy) {
      throw Error('Wait for the current operation.');
    }
    activity.busy = true;
    ports.update();
    try {
      const result = await api(route, record, {
        ...payload,
        project_revision: workspaceState.revision,
      });
      workspaceState.project = decodeProject(result.project);
      workspaceState.revision = string(result.revision);
      brushes.definitionBrush = null;
      status.textContent =
        'Object definition library saved. Scene history and unsaved edits are preserved.';
      ports.draw();
    } finally {
      activity.busy = false;
      ports.update();
    }
  }

  let pendingDiagnostic: DiagnosticLocation | null = null;

  function focusDiagnostic() {
    const location = pendingDiagnostic;
    pendingDiagnostic = null;
    if (
      !location ||
      !sceneSession.editor ||
      !location.scene ||
      location.scene !== sceneSession.loaded?.id
    ) {
      return;
    }
    const item = sceneSession.editor.layers
      .flatMap((l) => (l.type === 'objectgroup' ? l.objects : []))
      .find((o) => Number(o.id) === location.object);
    if (location.object) {
      pendingWorldEndpoint = { scene: location.scene, object: location.object };
      focusWorldEndpoint();
    } else if (location.layer && sceneSession.editor.layers.some((l) => l.id === location.layer)) {
      sceneSession.editor.activate(location.layer);
      ports.draw();
      editorLayout.reveal(element('layers-panel', HTMLElement));
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
    if (
      !endpoint ||
      !sceneSession.editor ||
      sceneSession.loaded?.id !== endpoint.scene ||
      !endpoint.object
    ) {
      return;
    }
    const layer = sceneSession.editor.layers.find(
      (l) => l.type === 'objectgroup' && l.objects.some((o) => Number(o.id) === endpoint.object),
    );
    if (!layer) {
      status.textContent =
        'Connection endpoint object is missing. Choose a replacement in World view.';
      return;
    }
    sceneSession.editor.activate(layer.id);
    sceneSelection.selectedObject = String(endpoint.object);
    sceneSelection.selectedObjects.clear();
    sceneSelection.selection = null;
    ports.draw();
    editorLayout.reveal(element('selection-panel', HTMLElement));
    status.textContent = layer.visible
      ? 'Connection endpoint selected.'
      : 'Connection endpoint selected on a hidden layer. Show its layer to edit it.';
  }

  const worldView = createWorldView(
    async () => {
      const report = await api('world-report', record, {
        project_revision: workspaceState.revision,
        ...(sceneSession.loaded && sceneSession.editor
          ? {
              scene_id: sceneSession.loaded.id,
              scene_revision: sceneSession.loaded.revision,
              scene: sceneSession.serialize(),
            }
          : {}),
      });
      return {
        world: workspaceState.project?.world ?? decodeWorld(undefined),
        snapshot: decodeWorldSnapshot(report),
      };
    },
    async (world, sceneRevisions) => {
      if (activity.busy) {
        throw Error('Wait for the current operation.');
      }
      activity.busy = true;
      ports.update();
      try {
        const result = await api('save-world', record, {
          world,
          scene_revisions: sceneRevisions,
          project_revision: workspaceState.revision,
        });
        workspaceState.project = decodeProject(result.project);
        workspaceState.revision = string(result.revision);
        status.textContent = 'World saved. Open scene edits and history are preserved.';
      } finally {
        activity.busy = false;
        ports.update();
      }
    },
    (endpoint) => {
      pendingWorldEndpoint = endpoint;
      if (endpoint.scene === sceneSession.loaded?.id) {
        focusWorldEndpoint();
        return;
      }
      if (!workspaceState.project?.scenes.some((s) => s.id === endpoint.scene)) {
        pendingWorldEndpoint = null;
        status.textContent = 'Connection destination scene is missing.';
        return;
      }
      ports.requestSceneOpen(endpoint.scene);
    },
    lifetime,
  );

  lifetime.assign(button('show-world'), 'onclick', () => void ports.run(() => worldView.open()));

  const diagnosticsView = createDiagnosticsView(
    () => ({
      definitions: workspaceState.project?.definitions ?? [],
      scenes: workspaceState.project?.scenes ?? [],
    }),
    (options) =>
      api('diagnostics-report', record, {
        options,
        project_revision: workspaceState.revision,
        ...(sceneSession.loaded && sceneSession.editor
          ? {
              scene_id: sceneSession.loaded.id,
              scene_revision: sceneSession.loaded.revision,
              scene: sceneSession.serialize(),
            }
          : {}),
      }),
    (location) => {
      if (location.scene && workspaceState.project?.scenes.some((s) => s.id === location.scene)) {
        pendingDiagnostic = location;
        if (location.scene === sceneSession.loaded?.id) {
          focusDiagnostic();
        } else {
          ports.requestSceneOpen(location.scene);
        }
      } else if (location.connection) {
        void ports.run(() => worldView.open());
      } else if (location.asset) {
        editorLayout.showLibrary('artwork');
        status.textContent = `Unused asset ${location.asset}. Select it in the palette to inspect its artwork and metadata.`;
        input('search').value = '';
        select('atlas-filter').value = '';
        select('kind-filter').value = '';
        ports.filterPalette();
        const node = Array.from(element('palette', HTMLElement).querySelectorAll('button')).find(
          (b) => b.dataset.asset === location.asset?.split('/').slice(0, 2).join('/'),
        );
        node?.scrollIntoView({ block: 'center' });
        node?.focus();
      }
    },
    lifetime,
  );

  lifetime.assign(button('show-diagnostics'), 'onclick', () => diagnosticsView.open());

  const definitionLibrary = createDefinitionLibrary(
    () => workspaceState.project?.definitions ?? [],
    () =>
      Object.entries(workspaceState.project?.atlases ?? {}).flatMap(([id, a]) =>
        a.regions.filter((r) => r.kind === 'sprite').map((r) => `${id}/${r.name}`),
      ),
    (value) => definitionMutation('save-object-definition', { definition: value }),
    (id) => definitionMutation('delete-object-definition', { id }),
    lifetime,
  );

  lifetime.assign(button('manage-definitions'), 'onclick', () => definitionLibrary.open());

  lifetime.assign(button('place-definition'), 'onclick', () => {
    if (!sceneSession.editor || activity.busy || !workspaceState.project) {
      return;
    }
    const definition = workspaceState.project.definitions.find(
      (d) => d.id === select('object-definition-brush').value,
    );
    if (!definition) {
      return;
    }
    const layer =
      sceneSession.editor.active.type === 'objectgroup' && sceneSession.editor.active.visible
        ? sceneSession.editor.active
        : sceneSession.editor.layers.find((l) => l.visible && l.type === 'objectgroup');
    if (!layer) {
      status.textContent = 'Add an object layer before placing instances.';
      return;
    }
    sceneSession.editor.activate(layer.id);
    brushes.brush = null;
    brushes.spriteBrush = null;
    brushes.objectBrush = null;
    brushes.stampBrush = null;
    brushes.definitionBrush = definition.id;
    const tool = document.querySelector<HTMLInputElement>('input[value="paint"]');
    if (tool) {
      tool.checked = true;
    }
    element('paint-label', HTMLElement).textContent = 'Place instance';
    element('selected-brush', HTMLElement).textContent = definition.name;
    status.textContent =
      'Click to place an instance. Select it to set overrides or reset shared defaults.';
    ports.draw();
  });

  lifetime.assign(select('object-definition-brush'), 'onchange', () => {
    brushes.definitionBrush = null;
    ports.update();
  });

  let renderedDefinitions = '';

  function renderObjectValidation() {
    const encoded = JSON.stringify(workspaceState.project?.definitions ?? []);
    if (encoded !== renderedDefinitions) {
      const previous = select('object-definition-brush').value;
      select('object-definition-brush').replaceChildren(
        new Option('Choose definition…', ''),
        ...(workspaceState.project?.definitions ?? []).map((d) => new Option(d.name, d.id)),
      );
      select('object-definition-brush').value = workspaceState.project?.definitions.some(
        (d) => d.id === previous,
      )
        ? previous
        : '';
      renderedDefinitions = encoded;
    }
    const container = element('object-findings', HTMLElement);
    container.replaceChildren();
    let instances = 0,
      count = 0;
    for (const layer of sceneSession.editor?.layers ?? []) {
      if (layer.type !== 'objectgroup') {
        continue;
      }
      for (const item of layer.objects) {
        if (!item.definition) {
          continue;
        }
        instances++;
        const findings = resolveDefinition(
          item,
          workspaceState.project?.definitions ?? [],
        ).findings;
        count += findings.length;
        for (const finding of findings) {
          if (container.children.length >= 100) {
            break;
          }
          const link = document.createElement('button');
          link.className = 'small';
          link.disabled = activity.busy || gestures.anchor !== null;
          link.textContent = `${layer.name} / ${item.name || '#' + item.id} / ${finding.field || 'definition'}: ${describeFinding(item, finding, workspaceState.project?.definitions ?? [])}${layer.visible ? '' : ' (hidden layer)'}`;
          lifetime.assign(link, 'onclick', () => {
            if (!sceneSession.editor || activity.busy || gestures.anchor) {
              return;
            }
            sceneSession.editor.activate(layer.id);
            sceneSelection.selectedObject = item.id;
            sceneSelection.selectedObjects.clear();
            sceneSelection.selection = null;
            if (!layer.visible) {
              status.textContent = 'Show this layer to edit its object.';
            }
            ports.draw();
          });
          container.append(link);
        }
      }
    }
    element('object-validation-summary', HTMLElement).textContent = sceneSession.editor
      ? `${instances} linked instances · ${count} findings${count > 100 ? ' (first 100 shown)' : ''}. Checks include hidden layers and current unsaved edits.`
      : 'Open a scene to validate its objects.';
  }

  lifetime.assign(select('object-list'), 'onchange', () => {
    sceneSelection.selectedObjects.clear();
    sceneSelection.selectedObject = select('object-list').value || null;
    sceneSelection.selection = null;
    const control = document.querySelector<HTMLInputElement>('input[value="select"]');
    if (control) {
      control.checked = true;
    }
    ports.draw();
  });

  function blockoutCameras() {
    return (sceneSession.editor?.layers ?? []).flatMap((layer) =>
      layer.visible && layer.type === 'objectgroup'
        ? layer.objects.flatMap((item) => {
            const style = blockoutAppearance(item, workspaceState.project?.definitions ?? []);
            return item.kind === 'rectangle' && style?.role === 'camera'
              ? [
                  {
                    item,
                    layer: layer.id,
                    scrollX: style.properties.scroll_x === true,
                    scrollY: style.properties.scroll_y === true,
                  },
                ]
              : [];
          })
        : [],
    );
  }

  function focusBlockoutCamera(id: string, edit: boolean) {
    const found = blockoutCameras().find((c) => c.item.id === id);
    if (!found || !sceneSession.editor || activity.busy) {
      return;
    }
    sceneSession.editor.activate(found.layer);
    sceneSelection.selectedObject = found.item.id;
    sceneSelection.selectedObjects.clear();
    sceneSelection.selection = null;
    brushes.definitionBrush = null;
    brushes.stampBrush = null;
    const tool = document.querySelector<HTMLInputElement>('input[name="tool"][value="select"]');
    if (tool) {
      tool.checked = true;
    }
    ports.draw();
    if (edit) {
      objectInspector.open();
    } else {
      const zoom = ports.sceneZoom();
      ports.viewport.scrollTo(
        Math.max(0, found.item.x * zoom - 32),
        Math.max(0, found.item.y * zoom - 32),
      );
      canvas.focus({ preventScroll: true });
      status.textContent =
        'Drag the camera to move it. Resize its bottom-right handle or use Settings for dimensions and scrolling axes.';
    }
  }

  const blockoutView = createBlockoutView(
    () => ({
      definitions: workspaceState.project?.definitions ?? [],
      cameras: blockoutCameras(),
      width: (sceneSession.editor?.scene.width ?? 0) * (sceneSession.loaded?.grid ?? 8),
      height: (sceneSession.editor?.scene.height ?? 0) * (sceneSession.loaded?.grid ?? 8),
      grid: sceneSession.loaded?.grid ?? 8,
      busy: activity.busy,
      hasScene: sceneSession.editor !== null,
    }),
    (name, options) =>
      void (async () => {
        if (!(await ports.discard())) {
          return;
        }
        await ports.run(async () => {
          const result = await api('create-blockout-scene', decodeLoaded, {
            name,
            options,
            project_revision: workspaceState.revision,
          });
          await ports.clearDraft();
          if (!(await ports.refresh()) || lifetime.disposed) {
            return;
          }
          ports.open(result);
          editorLayout.showLibrary('blockout');
          blockoutView.closeCreate();
          ports.fitScene();
          status.textContent =
            'Blockout created. Choose a preset and draw geometry or place markers.';
        });
      })(),
    (definition) => {
      if (!sceneSession.editor || !workspaceState.project || activity.busy || gestures.anchor) {
        return;
      }
      const preferred = blockoutLayer(definitionRole(definition), definition.kind);
      const layer =
        sceneSession.editor.layers.find(
          (l) => l.visible && l.type === 'objectgroup' && l.name === preferred,
        ) ??
        (sceneSession.editor.active.type === 'objectgroup' && sceneSession.editor.active.visible
          ? sceneSession.editor.active
          : sceneSession.editor.layers.find((l) => l.visible && l.type === 'objectgroup'));
      if (!layer) {
        status.textContent = 'Show or add an object layer before placing a preset.';
        return;
      }
      sceneSession.editor.activate(layer.id);
      brushes.definitionBrush = definition.id;
      brushes.brush = null;
      brushes.spriteBrush = null;
      brushes.objectBrush = null;
      brushes.stampBrush = null;
      const tool = document.querySelector<HTMLInputElement>('input[name="tool"][value="paint"]');
      if (tool) {
        tool.checked = true;
      }
      element('paint-label', HTMLElement).textContent =
        definition.kind === 'rectangle' ? 'Draw region' : 'Place marker';
      element('selected-brush', HTMLElement).textContent = definition.name;
      status.textContent =
        definition.kind === 'rectangle'
          ? 'Drag to draw a region. Select to move or resize; use Edit selected object for properties.'
          : 'Click to place a marker. Use Edit selected object to name it or change typed properties.';
      ports.draw();
    },
    focusBlockoutCamera,
    (id) =>
      void ports.run(async () => {
        if (!sceneSession.loaded || !sceneSession.editor) {
          return;
        }
        const result = await api('blockout-review', record, {
          project_revision: workspaceState.revision,
          scene_id: sceneSession.loaded.id,
          scene_revision: sceneSession.loaded.revision,
          scene: sceneSession.serialize(),
          camera_id: Number(id),
        });
        blockoutView.present(result);
      }),
    lifetime,
  );
  return {
    blockoutView,
    focusWorldEndpoint,
    focusDiagnostic,
    get pendingWorldEndpoint() {
      return pendingWorldEndpoint;
    },
    set pendingWorldEndpoint(value: Endpoint | null) {
      pendingWorldEndpoint = value;
    },
    get pendingDiagnostic() {
      return pendingDiagnostic;
    },
    set pendingDiagnostic(value: DiagnosticLocation | null) {
      pendingDiagnostic = value;
    },
    renderObjectValidation,
    palettePanel,
  };
}
