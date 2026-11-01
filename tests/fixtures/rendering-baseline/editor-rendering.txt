import type { EditorLifetime } from './editor-lifetime.mts';
import type { createAnimationPreview } from '../preview/animation-preview.mts';
import type { createBlockoutLabels } from '../blockout/blockout-labels.mts';
import { labelCandidates } from '../blockout/blockout-labels.mts';
import { blockoutAppearance, drawBlockout } from '../blockout/blockout.mts';
import { element, input } from './editor-dom.mts';
import type {
  BrushState,
  EditorActivity,
  GestureState,
  SceneSelection,
  SceneSession,
  WorkspaceState,
} from './editor-state.mts';
import type { PreviewRect } from '../preview/movement-preview.mts';
import { sceneOverlaps } from '../preview/movement-preview.mts';
import type { SceneObject } from '../objects/objects.mts';
import { objectBounds } from '../objects/objects.mts';
import type { Region } from '../project/project-contracts.mts';
import type { TileMetadata } from '../artwork/tile-metadata.mts';
import { drawCollision, terrainColor } from '../artwork/tile-metadata.mts';
import { tileContext, tileParts } from '../artwork/tile-transform.mts';

/** One transient paint belongs to the current mounted scene, never a captured snapshot. */
export function createHoverPaint(
  lifetime: EditorLifetime,
  sceneSession: Pick<SceneSession, 'editor' | 'loaded'>,
  paint: () => void,
) {
  let pending: number | undefined;
  function cancel() {
    if (pending !== undefined) {
      lifetime.cancelFrame(pending);
      pending = undefined;
    }
  }
  function request() {
    if (
      lifetime.disposed ||
      pending !== undefined ||
      !sceneSession.editor ||
      !sceneSession.loaded
    ) {
      return;
    }
    const editor = sceneSession.editor;
    const { id, revision } = sceneSession.loaded;
    pending = lifetime.frame(() => {
      pending = undefined;
      if (
        sceneSession.editor === editor &&
        sceneSession.loaded?.id === id &&
        sceneSession.loaded.revision === revision
      ) {
        paint();
      }
    });
  }
  lifetime.cleanup(cancel);
  return { request, cancel };
}

export interface Ports {
  tileMetadata: (group: string, asset: string) => TileMetadata | undefined;
  syncBlockoutZoom: () => boolean;
  sceneZoom: () => number;
  update: () => void;
  regions: ReadonlyMap<string, { image: HTMLImageElement; x: number; y: number }>;
  sprites: ReadonlyMap<string, { image: HTMLImageElement; region: Region }>;
}
export function createRenderingController({
  lifetime,
  sceneSession,
  activity,
  sceneSelection,
  canvas,
  brushes,
  context,
  animationPreview,
  workspaceState,
  blockoutLabels,
  gestures,
  ports,
}: {
  lifetime: EditorLifetime;
  activity: Pick<EditorActivity, 'reviewing'>;
  sceneSession: Pick<SceneSession, 'editor' | 'loaded'>;
  sceneSelection: Pick<SceneSelection, 'selectedObject' | 'selectedObjects' | 'selection'>;
  canvas: HTMLCanvasElement;
  brushes: Pick<BrushState, 'brush' | 'planningScene'>;
  context: CanvasRenderingContext2D;
  animationPreview: ReturnType<typeof createAnimationPreview>;
  workspaceState: Pick<WorkspaceState, 'project'>;
  blockoutLabels: ReturnType<typeof createBlockoutLabels>;
  gestures: Pick<GestureState, 'hover' | 'pan' | 'spacePan'>;
  ports: Ports;
}) {
  const hoverPaint = createHoverPaint(lifetime, sceneSession, () => draw(false));

  function previewBlocked(rect: PreviewRect, selectedId: string): boolean {
    if (!sceneSession.editor || !sceneSession.loaded) {
      return false;
    }
    return sceneOverlaps(
      rect,
      sceneSession.editor.layers,
      sceneSession.loaded.grid,
      selectedId,
      ports.tileMetadata,
      bounds,
    );
  }

  function draw(refreshUI = true) {
    // Immediate authoring/selection and animation draws supersede queued hover work.
    hoverPaint.cancel();
    if (lifetime.disposed || !sceneSession.editor || !sceneSession.loaded) {
      return;
    }
    if (
      sceneSelection.selectedObject &&
      !(
        sceneSession.editor.active.type === 'objectgroup' &&
        sceneSession.editor.active.objects.some((item) => item.id === sceneSelection.selectedObject)
      )
    ) {
      sceneSelection.selectedObject = null;
      sceneSelection.selectedObjects.clear();
    }
    sceneSelection.selectedObjects = new Set(
      [...sceneSelection.selectedObjects].filter((id) =>
        sceneSession.editor?.layers.some(
          (l) => l.type === 'objectgroup' && l.objects.some((o) => o.id === id),
        ),
      ),
    );
    sceneSession.loaded = {
      ...sceneSession.loaded,
      width: sceneSession.editor.scene.width,
      height: sceneSession.editor.scene.height,
    };
    element('scene-name', HTMLElement).textContent =
      `${sceneSession.loaded.name} · ${sceneSession.loaded.width} × ${sceneSession.loaded.height} · ${sceneSession.loaded.grid}px`;
    const size = sceneSession.loaded.grid;
    const width = sceneSession.loaded.width * size;
    const height = sceneSession.loaded.height * size;
    // Assigning even the same backing dimensions clears pixels and context state.
    if (canvas.width !== width) {
      canvas.width = width;
    }
    if (canvas.height !== height) {
      canvas.height = height;
    }
    brushes.planningScene = ports.syncBlockoutZoom();
    const zoom = ports.sceneZoom();
    const displayWidth = `${width * zoom}px`;
    const displayHeight = `${height * zoom}px`;
    if (canvas.style.width !== displayWidth) {
      canvas.style.width = displayWidth;
    }
    if (canvas.style.height !== displayHeight) {
      canvas.style.height = displayHeight;
    }
    if (refreshUI) {
      ports.update();
    }
    context.imageSmoothingEnabled = false;
    // Repaints must not inherit styles or paths left by the previous frame.
    context.save();
    context.beginPath();
    try {
      repaint(size, zoom);
    } finally {
      context.restore();
    }
  }

  function repaint(size: number, zoom: number) {
    if (!sceneSession.editor) {
      return;
    }
    context.fillStyle = '#242820';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const layer of sceneSession.editor.layers) {
      if (!layer.visible) {
        continue;
      }
      if (layer.type === 'tilelayer') {
        layer.cells.forEach((row, y) =>
          row.forEach((cell, x) => {
            const [asset, flags] = tileParts(cell);
            const region = ports.regions.get(asset);
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
          const sprite = item.kind === 'sprite' && ports.sprites.get(item.asset);
          if (sprite) {
            const r =
              item.id === sceneSelection.selectedObject
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
          } else if (drawBlockout(context, item, workspaceState.project?.definitions ?? [])) {
            // Planning geometry uses the definition's portable typed appearance fields.
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
        const value = ports.tileMetadata(group, asset);
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
      for (const layer of sceneSession.editor.layers) {
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
    if (!activity.reviewing && sceneSelection.selection) {
      context.fillStyle = '#d4b76755';
      context.fillRect(
        sceneSelection.selection.x * size,
        sceneSelection.selection.y * size,
        sceneSelection.selection.w * size,
        sceneSelection.selection.h * size,
      );
    }
    for (const layer of sceneSession.editor.layers) {
      if (layer.visible && layer.type === 'objectgroup') {
        for (const item of layer.objects) {
          if (!activity.reviewing && sceneSelection.selectedObjects.has(item.id)) {
            const r = bounds(item);
            context.strokeStyle = '#f2d67b';
            context.lineWidth = 1;
            context.strokeRect(r.x, r.y, r.width, r.height);
          }
        }
      }
    }
    const selected = sceneSession.editor.objects.find(
      (r) => r.id === sceneSelection.selectedObject,
    );
    if (selected && !activity.reviewing) {
      const r = bounds(selected);
      context.strokeStyle = '#f2d67b';
      context.lineWidth = 0.75;
      context.strokeRect(r.x, r.y, r.width, r.height);
      context.fillStyle = '#f2d67b';
      context.fillRect(selected.x - 1, selected.y - 1, 2, 2);
      if (
        selected.kind === 'rectangle' &&
        blockoutAppearance(selected, workspaceState.project?.definitions ?? [])
      ) {
        const handle = 8 / zoom;
        context.fillRect(
          selected.x + selected.width - handle / 2,
          selected.y + selected.height - handle / 2,
          handle,
          handle,
        );
      }
      if (selected.kind === 'sprite') {
        animationPreview.movement.draw(context, selected.id + ':' + selected.asset);
      }
    }
    const tool = document.querySelector<HTMLInputElement>('input[name="tool"]:checked')?.value;
    blockoutLabels.update(
      labelCandidates(
        sceneSession.editor.layers.flatMap((layer) =>
          layer.visible && layer.type === 'objectgroup' ? layer.objects : [],
        ),
        workspaceState.project?.definitions ?? [],
        new Set([
          ...sceneSelection.selectedObjects,
          ...(sceneSelection.selectedObject ? [sceneSelection.selectedObject] : []),
        ]),
        zoom,
      ),
    );
    if (
      !activity.reviewing &&
      gestures.hover &&
      tool !== 'pan' &&
      !gestures.spacePan &&
      !gestures.pan
    ) {
      const width = tool === 'paint' && brushes.brush ? brushes.brush[0].length : 1;
      const height = tool === 'paint' && brushes.brush ? brushes.brush.length : 1;
      const valid =
        gestures.hover.x + width <= sceneSession.editor.scene.width &&
        gestures.hover.y + height <= sceneSession.editor.scene.height;
      context.strokeStyle = valid ? '#f2d67b' : '#ed886f';
      context.lineWidth = 0.5;
      context.strokeRect(
        gestures.hover.x * size + 0.25,
        gestures.hover.y * size + 0.25,
        width * size - 0.5,
        height * size - 0.5,
      );
    }
  }

  function point(event: { clientX: number; clientY: number }) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.floor(((event.clientX - rect.left) / rect.width) * (sceneSession.loaded?.width || 1)),
      y: Math.floor(
        ((event.clientY - rect.top) / rect.height) * (sceneSession.loaded?.height || 1),
      ),
      px: Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width),
      py: Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height),
    };
  }

  function trackHover(event: { clientX: number; clientY: number }) {
    const p = point(event);
    gestures.hover =
      sceneSession.loaded &&
      p.x >= 0 &&
      p.y >= 0 &&
      p.x < sceneSession.loaded.width &&
      p.y < sceneSession.loaded.height
        ? p
        : null;
    element('coordinates', HTMLElement).textContent = gestures.hover
      ? `Cell ${gestures.hover.x}, ${gestures.hover.y} · Pixel ${gestures.hover.px}, ${gestures.hover.py}`
      : 'Cell —, — · Pixel —, —';
  }

  function bounds(item: SceneObject) {
    return objectBounds(
      item,
      item.kind === 'sprite' ? ports.sprites.get(item.asset)?.region : undefined,
    );
  }

  function hitObject(px: number, py: number): SceneObject | undefined {
    return sceneSession.editor?.objects.findLast((item) => {
      const r = bounds(item);
      return px >= r.x && px < r.x + r.width && py >= r.y && py < r.y + r.height;
    });
  }

  function spritePosition(x: number, y: number, altKey: boolean, item?: SceneObject) {
    const step =
      input('snap').checked && !altKey && sceneSession.loaded ? sceneSession.loaded.grid : 1;
    const coordinate = (value: number, extent: number) =>
      Math.max(
        0,
        Math.min(Math.floor((extent - 1) / step) * step, Math.round(value / step) * step),
      );
    return {
      x: coordinate(x, canvas.width - (item?.kind === 'rectangle' ? item.width - 1 : 0)),
      y: coordinate(y, canvas.height - (item?.kind === 'rectangle' ? item.height - 1 : 0)),
    };
  }
  return {
    draw,
    requestHoverDraw: hoverPaint.request,
    previewBlocked,
    point,
    spritePosition,
    hitObject,
    trackHover,
  };
}
