import type { Composition } from './compositions.mts';
import { number } from './decode.mts';
import type { LayerEditor } from './layers.mts';
import { encodeObject } from './objects.mts';
import type { Loaded, Project } from './project-contracts.mts';
import type { Selection } from './types.ts';
export interface CanvasPoint {
  x: number;
  y: number;
  px: number;
  py: number;
}

export class WorkspaceState {
  choosingProject = false;
  hasProjectChoices = false;
  navigating = false;
  pendingProject = '';
  previewSettingsLoaded = false;
  revision = '';
  project: Project | null = null;
}

export class SceneSession {
  loaded: Loaded | null = null;
  committed: Loaded | null = null;
  editor: LayerEditor | null = null;
  baseline = '';
  snapshot() {
    return this.editor
      ? JSON.stringify({
          width: this.editor.scene.width,
          height: this.editor.scene.height,
          layers: this.editor.layers,
          nextLayer: this.editor.scene.next_layer_id,
          next: this.editor.scene.next_object_id,
        })
      : '';
  }
  dirty() {
    return this.snapshot() !== this.baseline;
  }
  serialize() {
    if (!this.editor || !this.loaded) {
      throw Error('Open a scene first.');
    }
    return {
      width: this.editor.scene.width,
      height: this.editor.scene.height,
      grid: this.loaded.grid,
      layers: this.editor.layers.map((layer) => ({
        id: layer.id,
        name: layer.name,
        type: layer.type,
        visible: layer.visible,
        ...(layer.type === 'tilelayer'
          ? { cells: layer.cells.map((row) => row.map((cell) => (cell === 'empty' ? '' : cell))) }
          : { objects: layer.objects.map(encodeObject) }),
      })),
      next_layer_id: number(this.editor.scene.next_layer_id),
      next_object_id: number(this.editor.scene.next_object_id),
    };
  }
}

export class SceneSelection {
  selectedObject: string | null = null;
  selectedObjects = new Set<string>();
  selection: Selection | null = null;
}

export class BrushState {
  brush: string[][] | null = null;
  spriteBrush: string | null = null;
  objectBrush: 'point' | 'rectangle' | null = null;
  planningScene = false;
  definitionBrush: string | null = null;
  clipboard: Composition | null = null;
  stampBrush: Composition | null = null;
}

export class GestureState {
  objectDrag: { id: string; x: number; y: number } | null = null;
  blockoutDraw: { id: string; x: number; y: number } | null = null;
  objectResize: { id: string; x: number; y: number } | null = null;
  anchor: { x: number; y: number; px: number; py: number } | null = null;
  hover: CanvasPoint | null = null;
  spacePan = false;
  pan: { pointer: number; x: number; y: number; left: number; top: number } | null = null;
}

export class EditorActivity {
  busy = false;
}
