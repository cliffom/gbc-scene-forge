import type { Scene } from './types.ts';
/** Shared scene and interaction state; controllers own their transient UI state. */
import type { Editor } from '../model.mts';
import type {
  Brush,
  Catalog,
  Comparison,
  Gesture,
  Marker,
  Point,
  Selection,
  Tool,
} from './types.ts';
export class EditorSession {
  private activeCatalog: Catalog | null = null;
  private activeEditor: Editor<Scene> | null = null;
  get catalog(): Catalog {
    if (!this.activeCatalog) {
      throw Error('Catalog has not loaded');
    }
    return this.activeCatalog;
  }
  set catalog(value: Catalog) {
    this.activeCatalog = value;
  }
  get editor(): Editor<Scene> {
    if (!this.activeEditor) {
      throw Error('No scene is open');
    }
    return this.activeEditor;
  }
  set editor(value: Editor<Scene>) {
    this.activeEditor = value;
  }
  get ready(): boolean {
    return this.activeCatalog !== null && this.activeEditor !== null;
  }
  gameScene: Scene | null = null;
  cellSize = 1;
  annotations: Marker[] = [];
  comparison: Comparison | null = null;
  tool: Tool = 'select';
  brush: Brush | undefined;
  selection: Selection | null = null;
  selectedReference: string | null = null;
  gesture: Gesture | null = null;
  hover: Point | null = null;
}
