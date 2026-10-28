/** Standalone layer and object editing, with shared scene history. */
import { Editor } from './model.mts';
import { validateObject } from './objects.mts';
import type { NewObject, ObjectRegion, SceneObject } from './objects.mts';

export type SceneLayer = {
  id: number;
  name: string;
  visible: boolean;
} & ({ type: 'tilelayer'; cells: string[][] } | { type: 'objectgroup'; objects: SceneObject[] });

export interface LayerScene {
  width: number;
  height: number;
  grid: number;
  layers: SceneLayer[];
  next_layer_id: number;
  next_object_id: number;
  active_layer_id?: number;
}
export class LayerEditor extends Editor<LayerScene> {
  get layers(): SceneLayer[] {
    if (!this.scene.layers?.length) {
      throw Error('A scene needs at least one layer.');
    }
    return this.scene.layers;
  }
  get active(): SceneLayer {
    return this.layers.find((layer) => layer.id === this.scene.active_layer_id) || this.layers[0];
  }
  activate(id: number) {
    if (this.stroke) {
      throw Error('Finish the current edit before changing layers.');
    }
    if (!this.layers.some((layer) => layer.id === id)) {
      throw Error('Unknown layer.');
    }
    this.scene.active_layer_id = id;
  }
  editable(type = this.active.type) {
    if (!this.active.visible) {
      throw Error('Show the active layer before editing it.');
    }
    if (this.active.type !== type) {
      throw Error(type === 'tilelayer' ? 'Choose a tile layer.' : 'Choose an object layer.');
    }
  }
  override check(x: number, y: number) {
    this.editable('tilelayer');
    super.check(x, y);
  }
  override get cells() {
    this.editable('tilelayer');
    const layer = this.active;
    return layer.type === 'tilelayer' ? layer.cells : [];
  }
  get objects(): SceneObject[] {
    const layer = this.active;
    return layer.type === 'objectgroup' && layer.visible ? layer.objects : [];
  }
  set objects(value: SceneObject[]) {
    this.editable('objectgroup');
    const layer = this.active;
    if (layer.type === 'objectgroup') {
      layer.objects = value;
    }
  }
  spriteRegion: (asset: string) => ObjectRegion | undefined = () => undefined;
  validateObject(item: SceneObject) {
    validateObject(
      item,
      this.scene.width * Number(this.scene.grid),
      this.scene.height * Number(this.scene.grid),
      item.kind === 'sprite' ? this.spriteRegion(item.asset) : undefined,
    );
  }
  createObject(value: NewObject) {
    this.editable('objectgroup');
    if (this.objects.length >= 4096) {
      throw Error('Use at most 4096 objects per layer.');
    }
    const item: SceneObject = { ...structuredClone(value), id: String(this.scene.next_object_id) };
    this.validateObject(item);
    this.change((scene) => {
      this.objects.push(item);
      scene.next_object_id = Number(scene.next_object_id) + 1;
    });
    return item.id;
  }
  replaceObject(item: SceneObject) {
    this.editable('objectgroup');
    this.validateObject(item);
    const index = this.objects.findIndex((existing) => existing.id === item.id);
    if (index < 0) {
      throw Error('Select an object on the active layer.');
    }
    this.change(() => {
      this.objects[index] = structuredClone(item);
    });
  }
  add(type: SceneLayer['type']) {
    if (this.layers.length >= 128) {
      throw Error('Use at most 128 layers.');
    }
    this.change((scene) => {
      const id = Number(scene.next_layer_id);
      const common = {
        id,
        name: type === 'tilelayer' ? 'Tile layer' : 'Object layer',
        visible: true,
      };
      this.layers.push(
        type === 'tilelayer'
          ? {
              ...common,
              type,
              cells: Array.from({ length: scene.height }, () =>
                Array<string>(scene.width).fill(this.floor),
              ),
            }
          : { ...common, type, objects: [] },
      );
      scene.next_layer_id = id + 1;
      scene.active_layer_id = id;
    });
  }
  rename(name: string) {
    name = name.trim();
    if (!name || name.length > 100) {
      throw Error('Layer name must contain 1..100 characters.');
    }
    this.change(() => {
      this.active.name = name;
    });
  }
  visibility(id = this.active.id) {
    const layer = this.layers.find((layer) => layer.id === id);
    if (!layer) {
      throw Error('Unknown layer.');
    }
    this.change(() => {
      layer.visible = !layer.visible;
    });
  }
  reorder(delta: number) {
    const from = this.layers.indexOf(this.active),
      to = from + delta;
    if (to < 0 || to >= this.layers.length) {
      return;
    }
    this.change(() => {
      const [layer] = this.layers.splice(from, 1);
      this.layers.splice(to, 0, layer);
    });
  }
  moveLayer(id: number, beforeId: number | null) {
    const ordered = [...this.layers].reverse();
    const layer = ordered.find((layer) => layer.id === id);
    if (!layer || (beforeId !== null && !ordered.some((layer) => layer.id === beforeId))) {
      throw Error('Unknown layer.');
    }
    if (id === beforeId) {
      return;
    }
    const remaining = ordered.filter((layer) => layer.id !== id);
    remaining.splice(
      beforeId === null ? remaining.length : remaining.findIndex((layer) => layer.id === beforeId),
      0,
      layer,
    );
    if (remaining.every((layer, index) => layer === ordered[index])) {
      return;
    }
    this.change(() => {
      this.scene.layers = remaining.reverse();
    });
  }
  remove() {
    if (this.layers.length === 1) {
      throw Error('Keep at least one layer.');
    }
    this.change((scene) => {
      const index = this.layers.indexOf(this.active);
      this.layers.splice(index, 1);
      scene.active_layer_id = this.layers[Math.min(index, this.layers.length - 1)].id;
    });
  }
}
