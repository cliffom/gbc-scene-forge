import { createGenericImport } from './generic-import.mts';
import type { EditorLifetime } from '../editor/editor-lifetime.mts';
import type { AtlasFolder } from './atlas-import.mts';
import { chooseFolder, readBundle } from './atlas-import.mts';
import { array, record, string } from '../shared/decode.mts';
import { button, element, form, input, select } from '../editor/editor-dom.mts';
import type { createEditorLayout } from '../editor/editor-layout.mts';
import type {
  BrushState,
  EditorActivity,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from '../editor/editor-state.mts';
import type { LayerScene } from '../scene/layers.mts';
import type { ProjectApi } from '../project/project-api.mts';
import type { Loaded, Region } from '../project/project-contracts.mts';
import { decodeLoaded, decodeProject } from '../project/project-contracts.mts';
import type { TileMetadata } from './tile-metadata.mts';
import { tileParts, transformMetadata } from './tile-transform.mts';

export interface Ports {
  syncPanCursor: () => void;
  draw: (refreshUI?: boolean) => void;
  discard: () => Promise<boolean>;
  run: (work: () => Promise<void> | void) => Promise<void>;
  clearDraft: () => Promise<void>;
  refresh: (
    supplied?: Record<string, unknown>,
    canApply?: () => Promise<boolean>,
  ) => Promise<boolean>;
  open: (data: Loaded, chooseInitialBrush?: boolean) => void;
  update: () => void;
}
export function createArtworkController({
  lifetime,
  workspaceState,
  sceneSession,
  brushes,
  activity,
  editorLayout,
  sceneSelection,
  status,
  api,
  ports,
}: {
  lifetime: EditorLifetime;
  workspaceState: Pick<WorkspaceState, 'project' | 'revision'>;
  sceneSession: Pick<SceneSession, 'committed' | 'editor' | 'loaded'>;
  brushes: Pick<
    BrushState,
    'brush' | 'definitionBrush' | 'objectBrush' | 'spriteBrush' | 'stampBrush'
  >;
  activity: EditorActivity;
  editorLayout: ReturnType<typeof createEditorLayout>;
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  status: HTMLElement;
  api: ProjectApi['json'];
  ports: Ports;
}) {
  let atlasFolder: AtlasFolder | null = null;

  let deleteAtlasCandidate: { id: string; projectRevision: string } | null = null;

  const images = new Map<string, HTMLImageElement>();

  const artworkBrushes = new Map<string, () => void>();

  const regions = new Map<string, { image: HTMLImageElement; x: number; y: number }>();

  const sprites = new Map<string, { image: HTMLImageElement; region: Region }>();

  function tileMetadata(group: string, asset: string): TileMetadata | undefined {
    const [base, flags] = tileParts(asset);
    const value = workspaceState.project?.atlases[base.split('/')[0]]?.metadata[group]?.[base];
    if (!value || !flags || group === 'sprites') {
      return value;
    }
    return transformMetadata(value, flags, Number(group));
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
        : !sceneSession.loaded
          ? 'Open or create a scene to start using these assets.'
          : 'Choose a tile to paint or a sprite to place. Dimmed tiles need a smaller grid.';
  }

  function captureBrush() {
    return {
      artwork:
        brushes.brush || brushes.spriteBrush
          ? element('palette', HTMLElement).querySelector<HTMLButtonElement>(
              '[aria-pressed="true"]',
            )?.dataset.asset
          : undefined,
      object: brushes.objectBrush,
      definition: brushes.definitionBrush,
      stamp: brushes.stampBrush ? select('stamps').value : null,
      paintLabel: element('paint-label', HTMLElement).textContent,
      label: element('selected-brush', HTMLElement).textContent,
    };
  }

  function restoreBrush(choice: ReturnType<typeof captureBrush>) {
    brushes.brush = null;
    brushes.spriteBrush = null;
    brushes.objectBrush = null;
    brushes.definitionBrush = null;
    brushes.stampBrush = null;
    element('paint-label', HTMLElement).textContent = 'Paint';
    element('selected-brush', HTMLElement).textContent = 'Select a brush';
    const definition = workspaceState.project?.definitions.find((d) => d.id === choice.definition);
    const stamp = workspaceState.project?.stamps.find((s) => s.id === choice.stamp);
    // Losing an active preset/stamp must not fall through to a background brush.
    if ((choice.definition && !definition) || (choice.stamp && !stamp)) {
      return;
    }
    if (choice.artwork) {
      // Bind fresh palette cells/images without changing tool, layer, selection,
      // library tab, or issuing another draw. Missing artwork stays unselected.
      artworkBrushes.get(choice.artwork)?.();
    }
    brushes.objectBrush = choice.object;
    brushes.definitionBrush = definition?.id ?? null;
    brushes.stampBrush = stamp?.composition ?? null;
    if (definition || brushes.objectBrush || brushes.stampBrush) {
      element('paint-label', HTMLElement).textContent =
        definition && choice.paintLabel !== 'Place instance'
          ? definition.kind === 'rectangle'
            ? 'Draw region'
            : 'Place marker'
          : choice.paintLabel;
      element('selected-brush', HTMLElement).textContent = definition?.name ?? choice.label;
    }
  }

  function palette(chooseInitial = true) {
    const paletteElement = element('palette', HTMLElement);
    paletteElement.replaceChildren();
    regions.clear();
    sprites.clear();
    artworkBrushes.clear();
    brushes.brush = null;
    brushes.spriteBrush = null;
    brushes.definitionBrush = null;
    brushes.objectBrush = null;
    if (!workspaceState.project) {
      return;
    }
    const size = sceneSession.loaded?.grid ?? 8;
    let initialBrush: (() => void) | null = null;
    for (const [id, atlas] of Object.entries(workspaceState.project.atlases)) {
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
        item.disabled = !sceneSession.loaded || (!sprite && !compatible);
        item.draggable = !item.disabled;
        lifetime.assign(item, 'ondragstart', (event) => {
          if (activity.busy || !event.dataTransfer) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.setData('application/x-forge-asset', asset);
          event.dataTransfer.effectAllowed = 'copy';
        });
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
        const selectBrush = () => {
          brushes.stampBrush = null;
          brushes.definitionBrush = null;
          brushes.objectBrush = null;
          brushes.brush = sprite ? null : cells;
          brushes.spriteBrush = sprite ? asset : null;
          paletteElement
            .querySelectorAll('button')
            .forEach((b) => b.setAttribute('aria-pressed', 'false'));
          item.setAttribute('aria-pressed', 'true');
          element('paint-label', HTMLElement).textContent = sprite ? 'Place sprite' : 'Paint';
          element('selected-brush', HTMLElement).textContent = `${id} / ${region.name}`;
        };
        if (!item.disabled) {
          artworkBrushes.set(asset, selectBrush);
        }
        const chooseAsset = (reveal = true) => {
          if (reveal) {
            editorLayout.showLibrary('artwork');
          }
          brushes.stampBrush = null;
          if (
            sceneSession.editor &&
            sceneSession.editor.active.type !== (sprite ? 'objectgroup' : 'tilelayer')
          ) {
            const layer = sceneSession.editor.layers.find(
              (layer) => layer.visible && layer.type === (sprite ? 'objectgroup' : 'tilelayer'),
            );
            if (layer) {
              sceneSession.editor.activate(layer.id);
              sceneSelection.selection = null;
              sceneSelection.selectedObject = null;
              sceneSelection.selectedObjects.clear();
            }
          }
          selectBrush();
          const paint = document.querySelector<HTMLInputElement>('input[value="paint"]');
          if (paint) {
            paint.checked = true;
          }
          ports.syncPanCursor();
          status.textContent = sprite
            ? `Click the canvas to place ${region.name}. Select to drag it; Delete removes it.`
            : `Paint ${region.name}.`;
          ports.draw();
        };
        lifetime.assign(item, 'onclick', () => chooseAsset());
        paletteElement.append(item);
        if (!initialBrush && !item.disabled) {
          initialBrush = () => chooseAsset(false);
        }
      }
    }
    if (chooseInitial) {
      initialBrush?.();
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

  createGenericImport({
    lifetime,
    api,
    ports,
    revision: () => workspaceState.revision,
    sceneId: () => sceneSession.loaded?.id,
    status,
  });

  lifetime.assign(form('import-form'), 'onsubmit', async (event) => {
    event.preventDefault();
    if (select('import-kind').value !== 'atlas') {
      return;
    }
    if (!(await ports.discard())) {
      return;
    }
    void ports.run(async () => {
      if (!atlasFolder && !input('atlas-path').value.trim()) {
        throw Error('Choose an atlas folder or enter a manifest path.');
      }
      const report = await api('import-atlas', record, {
        ...(atlasFolder
          ? { bundle: await readBundle(atlasFolder, select('atlas-manifest').value) }
          : { path: input('atlas-path').value }),
        reimport: input('reimport').checked,
        project_revision: workspaceState.revision,
      });
      await ports.clearDraft();
      if (!(await ports.refresh()) || lifetime.disposed) {
        return;
      }
      if (sceneSession.loaded) {
        ports.open(await api(`scene/${sceneSession.loaded.id}`, decodeLoaded));
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
  });

  lifetime.assign(button('browse-atlas'), 'onclick', () => {
    void ports.run(async () => {
      const browse = button('browse-atlas');
      browse.textContent = 'Choosing…';
      status.textContent = 'Choose the folder containing your atlas.';
      try {
        const selected = await chooseFolder(input('atlas-folder-files'), lifetime.signal);
        if (lifetime.disposed) {
          return;
        }
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
        if (!lifetime.disposed) {
          browse.textContent = 'Browse folder…';
        }
      }
    });
  });

  lifetime.assign(input('atlas-path'), 'oninput', () => {
    atlasFolder = null;
    element('atlas-folder-name', HTMLElement).textContent = 'No folder selected';
    element('atlas-manifest-field', HTMLElement).hidden = true;
    select('atlas-manifest').required = false;
  });

  function showImport(reimport = false) {
    if (activity.busy) {
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
      sceneSession.editor &&
      [...sceneSession.editor.undoStack, ...sceneSession.editor.redoStack].some((scene) =>
        usesAtlas(scene, id),
      ),
    );
  }

  function showDeleteAtlas(id: string) {
    if (activity.busy || !workspaceState.project?.atlases[id]) {
      return;
    }
    deleteAtlasCandidate = { id, projectRevision: workspaceState.revision };
    element('delete-atlas-description', HTMLElement).textContent =
      `Delete “${id}” and its imported assets?`;
    element('delete-atlas-history', HTMLElement).hidden = !atlasInHistory(id);
    const error = form('delete-atlas-form').querySelector('.form-error');
    if (error) {
      error.textContent =
        sceneSession.editor && usesAtlas(sceneSession.editor.scene, id)
          ? 'The open scene uses this atlas. Remove its placements and save before deleting it.'
          : '';
    }
    element('delete-atlas-dialog', HTMLDialogElement).showModal();
    ports.update();
  }

  lifetime.assign(form('delete-atlas-form'), 'onsubmit', (event) => {
    event.preventDefault();
    const candidate = deleteAtlasCandidate;
    if (
      !candidate ||
      activity.busy ||
      (sceneSession.editor && usesAtlas(sceneSession.editor.scene, candidate.id))
    ) {
      return;
    }
    void ports.run(async () => {
      const result = await api('delete-atlas', record, {
        id: candidate.id,
        project_revision: candidate.projectRevision,
        scene: sceneSession.loaded
          ? { id: sceneSession.loaded.id, revision: sceneSession.loaded.revision }
          : null,
      });
      if (string(result.deleted) !== candidate.id) {
        throw Error('Unexpected deleted atlas response');
      }
      workspaceState.project = decodeProject(result.project);
      workspaceState.revision = string(result.revision);
      if (sceneSession.loaded) {
        sceneSession.loaded = {
          ...sceneSession.loaded,
          revision: string(record(result.scene_revisions)[sceneSession.loaded.id]),
        };
        if (sceneSession.committed?.id === sceneSession.loaded.id) {
          sceneSession.committed = {
            ...sceneSession.committed,
            revision: sceneSession.loaded.revision,
          };
        }
      }
      if (sceneSession.editor && atlasInHistory(candidate.id)) {
        sceneSession.editor.undoStack = [];
        sceneSession.editor.redoStack = [];
      }
      element('delete-atlas-dialog', HTMLDialogElement).close();
      deleteAtlasCandidate = null;
      if (!(await ports.refresh()) || lifetime.disposed) {
        return;
      }
      if (sceneSession.loaded && sceneSession.editor) {
        select('scenes').value = sceneSession.loaded.id;
        ports.draw();
      }
      status.textContent = `Deleted atlas “${candidate.id}”.`;
    });
  });
  return {
    regions,
    tileMetadata,
    sprites,
    filterPalette,
    image: (id: string) => images.get(id),
    replaceImages(next: ReadonlyMap<string, HTMLImageElement>) {
      images.clear();
      for (const [id, image] of next) {
        images.set(id, image);
      }
    },
    showImport,
    showDeleteAtlas,
    palette,
    captureBrush,
    restoreBrush,
    get deleteAtlasCandidate() {
      return deleteAtlasCandidate;
    },
    set deleteAtlasCandidate(value: { id: string; projectRevision: string } | null) {
      deleteAtlasCandidate = value;
    },
    usesAtlas,
  };
}
