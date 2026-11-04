/** One exact RGBA snapshot and upload surface owned by the mounted pixel editor. */
import type { PixelModel } from './pixel-model.mts';
import type { ArtworkFrame } from './artwork-contracts.mts';

export class ArtworkRaster {
  readonly canvas = document.createElement('canvas');
  private model: PixelModel | null = null;
  private data: ImageData | null = null;
  private serial = 0;
  private frames = new Map<string, number>();

  refresh(model: PixelModel) {
    const pixels = model.composite();
    const replaced = this.model !== model;
    if (replaced) {
      this.frames.clear();
      this.model = model;
    }
    let left = model.width,
      top = model.height,
      right = -1,
      bottom = -1;
    if (!this.data || this.data.width !== model.width || this.data.height !== model.height) {
      this.canvas.width = model.width;
      this.canvas.height = model.height;
      this.data = new ImageData(model.width, model.height);
      right = model.width - 1;
      bottom = model.height - 1;
      left = top = 0;
    }
    // Models expose mutable bytes, and history can replace them. Comparing the
    // owned snapshot catches both without trusting a persistent mutation flag.
    for (let i = 0; i < pixels.length; i += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        if (this.data.data[i + channel] !== pixels[i + channel]) {
          changed = true;
          this.data.data[i + channel] = pixels[i + channel];
        }
      }
      if (changed) {
        const x = (i / 4) % model.width,
          y = Math.floor(i / 4 / model.width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right >= left) {
      this.canvas
        .getContext('2d')
        ?.putImageData(this.data, 0, 0, left, top, right - left + 1, bottom - top + 1);
    }
    if (model.descriptor.version === 2) {
      const live = new Set(model.descriptor.frames.map((frame) => frame.id));
      for (const id of this.frames.keys()) {
        if (!live.has(id)) {
          this.frames.delete(id);
        }
      }
      for (const frame of model.descriptor.frames) {
        if (
          !this.frames.has(frame.id) ||
          (right >= frame.x &&
            bottom >= frame.y &&
            left < frame.x + frame.width &&
            top < frame.y + frame.height)
        ) {
          this.frames.set(frame.id, ++this.serial);
        }
      }
    }
  }
  stamp(frame: ArtworkFrame, repetitions: number) {
    return `${this.frames.get(frame.id)}:${frame.x},${frame.y},${frame.width},${frame.height}:${repetitions}`;
  }
  dispose() {
    this.canvas.width = this.canvas.height = 0;
    this.data = null;
    this.model = null;
    this.frames.clear();
  }
}
