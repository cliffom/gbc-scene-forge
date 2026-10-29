import type { EditorLifetime } from './editor-lifetime.mts';
import type { createAnimationPreview } from '../preview/animation-preview.mts';
import { blockoutAppearance } from '../blockout/blockout.mts';
import { button, element, input, select } from './editor-dom.mts';
import type {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';
import { layerDragging } from './layer-drag.mts';
import type { LayerEditor } from '../scene/layers.mts';
import type { PreviewRect } from '../preview/movement-preview.mts';
import type { Region } from '../project/project-contracts.mts';

export interface Ports {
  draw: (refreshUI?: boolean) => void;
  sprites: ReadonlyMap<string, { image: HTMLImageElement; region: Region }>;
  previewBlocked: (rect: PreviewRect, selectedId: string) => boolean;
}
export function createLayersController({
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
  ports,
}: {
  lifetime: EditorLifetime;
  activity: EditorActivity;
  sceneSession: Pick<SceneSession, 'editor' | 'loaded'>;
  gestures: Pick<GestureState, 'anchor' | 'objectDrag' | 'spacePan'>;
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  status: HTMLElement;
  brushes: Pick<BrushState, 'objectBrush' | 'spriteBrush'>;
  workspaceState: Pick<WorkspaceState, 'project'>;
  animationPreview: ReturnType<typeof createAnimationPreview>;
  canvas: HTMLCanvasElement;
  ports: Ports;
}) {
  function renderLayers() {
    const list = element('layers', HTMLElement);
    const disabled = activity.busy || !sceneSession.editor || gestures.anchor !== null;
    const focused = document.activeElement;
    const rows = (sceneSession.editor ? [...sceneSession.editor.layers].reverse() : []).map(
      (layer) => {
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
        lifetime.assign(radio, 'onchange', () =>
          layerAction((editor) => editor.activate(layer.id)),
        );
        lifetime.assign(eye, 'onclick', () =>
          layerAction(
            (editor) => editor.visibility(layer.id),
            layer.id === sceneSession.editor?.active.id,
          ),
        );
        eye.disabled = disabled;
        eye.setAttribute('aria-label', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`);
        eye.setAttribute('aria-pressed', String(layer.visible));
        eye.title = `${layer.visible ? 'Hide' : 'Show'} layer`;
        radio.value = String(layer.id);
        radio.checked = layer.id === sceneSession.editor?.active.id;
        radio.disabled = disabled;
        row.dataset.visible = String(layer.visible);
        icon.textContent = layer.type === 'tilelayer' ? '▦' : '◇';
        name.textContent = layer.name;
        meta.textContent = `${layer.type === 'tilelayer' ? 'Tiles' : 'Objects'} · ${layer.visible ? 'Visible' : 'Hidden'}`;
        return row;
      },
    );
    // Keep existing inputs mounted during canvas redraws and keyboard navigation.
    if (rows.length !== list.children.length || rows.some((row, i) => row !== list.children[i])) {
      list.replaceChildren(...rows);
      if (focused instanceof HTMLElement && list.contains(focused)) {
        focused.focus({ preventScroll: true });
      }
    }
    if (!sceneSession.editor) {
      list.textContent = 'Open a scene to view its layers.';
    }
    list.setAttribute('aria-disabled', String(disabled));
    input('layer-name').disabled = disabled;
    if (document.activeElement !== input('layer-name')) {
      input('layer-name').value = sceneSession.editor?.active.name || '';
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
    if (sceneSession.editor) {
      const index = sceneSession.editor.layers.indexOf(sceneSession.editor.active);
      button('layer-up').disabled ||= index === sceneSession.editor.layers.length - 1;
      button('layer-down').disabled ||= index === 0;
      button('layer-remove').disabled ||= sceneSession.editor.layers.length === 1;
      button('layer-visible').textContent = sceneSession.editor.active.visible
        ? 'Hide layer'
        : 'Show layer';
    }
  }

  function layerAction(work: (editor: LayerEditor) => void, clearSelection = true) {
    if (!sceneSession.editor || activity.busy || gestures.anchor) {
      return;
    }
    try {
      work(sceneSession.editor);
      if (clearSelection) {
        sceneSelection.selection = null;
        sceneSelection.selectedObject = null;
        sceneSelection.selectedObjects.clear();
        gestures.objectDrag = null;
      }
      input('layer-name').value = sceneSession.editor.active.name;
      ports.draw();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    }
  }

  lifetime.assign(input('layer-name'), 'onchange', () =>
    layerAction((editor) => editor.rename(input('layer-name').value)),
  );

  lifetime.assign(button('layer-tile'), 'onclick', () =>
    layerAction((editor) => editor.add('tilelayer')),
  );

  lifetime.assign(button('layer-object'), 'onclick', () =>
    layerAction((editor) => editor.add('objectgroup')),
  );

  lifetime.assign(button('layer-up'), 'onclick', () => layerAction((editor) => editor.reorder(1)));

  lifetime.assign(button('layer-down'), 'onclick', () =>
    layerAction((editor) => editor.reorder(-1)),
  );

  lifetime.assign(button('layer-visible'), 'onclick', () =>
    layerAction((editor) => editor.visibility()),
  );

  lifetime.assign(button('layer-remove'), 'onclick', () =>
    layerAction((editor) => editor.remove()),
  );

  layerDragging(
    element('layers', HTMLElement),
    (id, before) => layerAction((editor) => editor.moveLayer(id, before), false),
    lifetime,
  );

  function renderLayerContext() {
    const context = element('layer-context', HTMLElement);
    context.hidden = !sceneSession.editor;
    if (!sceneSession.editor) {
      return;
    }
    const layer = sceneSession.editor.active;
    const tool = gestures.spacePan
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
              : brushes.objectBrush
                ? 'Placing objects'
                : brushes.spriteBrush
                  ? 'Placing sprites'
                  : 'Painting';
    const text = layer.visible ? `${action} on ${layer.name}` : `${layer.name} is hidden`;
    const label = element('layer-context-text', HTMLElement);
    if (label.textContent !== text) {
      label.textContent = text;
    }
    context.dataset.hiddenLayer = String(!layer.visible);
    button('context-show-layer').hidden = layer.visible;
    button('context-show-layer').disabled = activity.busy || gestures.anchor !== null;
  }

  lifetime.assign(button('context-show-layer'), 'onclick', () =>
    layerAction((editor) => editor.visibility()),
  );

  function inspect() {
    input('inspector-name').value = sceneSession.loaded?.name || '';
    input('inspector-size').value = sceneSession.loaded
      ? `${sceneSession.loaded.width} × ${sceneSession.loaded.height} cells`
      : '';
    input('inspector-grid').value = sceneSession.loaded ? `${sceneSession.loaded.grid} px` : '';
    const objectCount =
      sceneSession.editor?.layers.reduce(
        (count, layer) => count + (layer.type === 'objectgroup' ? layer.objects.length : 0),
        0,
      ) || 0;
    element('scene-summary', HTMLElement).textContent =
      sceneSession.loaded && sceneSession.editor
        ? `${sceneSession.loaded.width * sceneSession.loaded.grid} × ${sceneSession.loaded.height * sceneSession.loaded.grid} pixels · ${objectCount} ${objectCount === 1 ? 'object' : 'objects'}`
        : 'Open a scene to inspect its dimensions and placed sprites.';
    const inspectedObjects =
      sceneSession.editor?.active.type === 'objectgroup' ? sceneSession.editor.active.objects : [];
    const item = inspectedObjects.find((r) => r.id === sceneSelection.selectedObject);
    const planning = item && blockoutAppearance(item, workspaceState.project?.definitions ?? []);
    const note = planning?.properties.design_note;
    const noteElement = element('selection-note', HTMLElement);
    noteElement.textContent = typeof note === 'string' ? note : '';
    noteElement.hidden = !noteElement.textContent;
    const inspector = document.querySelector('.inspector');
    const hasSelection = Boolean(
      item || sceneSelection.selection || sceneSelection.selectedObjects.size,
    );
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
            item.id === sceneSelection.selectedObject,
          ),
      ) || []),
    );
    select('object-list').disabled =
      activity.busy || !sceneSession.editor?.objects.length || gestures.anchor !== null;
    const sprite = item?.kind === 'sprite' && ports.sprites.get(item.asset);
    const atlas =
      item?.kind === 'sprite'
        ? workspaceState.project?.atlases[item.asset.split('/')[0]]
        : undefined;
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
              blocked: (rect) => ports.previewBlocked(rect, item.id),
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
    } else if (sceneSelection.selection) {
      element('selection-kind', HTMLElement).textContent =
        input('select-all-layers').checked || sceneSession.editor?.active.type === 'objectgroup'
          ? 'COMPOSITION'
          : 'TILES';
      element('selection-name', HTMLElement).textContent =
        `${sceneSelection.selection.w} × ${sceneSelection.selection.h} cells`;
      element('selection-detail', HTMLElement).textContent =
        `Column ${sceneSelection.selection.x}, row ${sceneSelection.selection.y}. Arrow keys move the selection; Delete erases it.`;
    } else if (sceneSelection.selectedObjects.size) {
      element('selection-kind', HTMLElement).textContent = 'OBJECTS';
      element('selection-name', HTMLElement).textContent =
        `${sceneSelection.selectedObjects.size} objects selected`;
      element('selection-detail', HTMLElement).textContent =
        'Copy, cut, duplicate or save this group as a reusable stamp. Shift-click toggles objects; Delete removes the group.';
    } else {
      element('selection-kind', HTMLElement).textContent = '—';
      element('selection-name', HTMLElement).textContent = 'Nothing selected';
      element('selection-detail', HTMLElement).textContent =
        'Select an object on the canvas or in the list to edit it, or select tiles on a tile layer.';
    }
  }
  return { layerAction, renderLayers, renderLayerContext, inspect };
}
