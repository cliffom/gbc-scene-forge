/** One artwork document, its serial checkpoint writer, and exact saved-base ownership. */
import type { ProjectApi } from '../project/project-api.mts';
import { record, string } from '../shared/decode.mts';
import { bytes, encoded, PixelModel } from './pixel-model.mts';
import { decodeCandidate, type Candidate } from './artwork-contracts.mts';

export class ArtworkSession {
  readonly model: PixelModel;
  readonly original: Candidate;
  candidate: Candidate;
  receipt: Record<string, unknown> | null = null;
  readonly id = crypto.randomUUID();
  readonly owner = crypto.randomUUID();
  revision: string | null = null;
  checkpointPixels = '';
  private queue: Promise<unknown> = Promise.resolve();
  private api: ProjectApi['json'];
  constructor(candidate: Candidate, api: ProjectApi['json'], original = candidate) {
    this.api = api;
    this.candidate = candidate;
    this.original = original;
    this.model = new PixelModel(candidate);
  }
  get changed() {
    return this.original.operation !== 'edit' || encoded(this.model.pixels) !== this.original.rgba;
  }
  get uncheckpointed() {
    return this.changed && encoded(this.model.pixels) !== this.checkpointPixels;
  }
  invalidate() {
    this.receipt = null;
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(work);
    this.queue = next;
    return next;
  }
  private async synchronize(pixels: Uint8ClampedArray) {
    const previous = bytes(this.candidate.rgba);
    let writes: { x: number; y: number; rgba: number[] }[] = [];
    const send = async () => {
      if (!writes.length) {
        return;
      }
      this.candidate = await this.api('artwork-edit', decodeCandidate, {
        candidate: this.candidate,
        writes,
      });
      writes = [];
    };
    for (let i = 0; i < pixels.length; i += 4) {
      if ([0, 1, 2, 3].every((channel) => previous[i + channel] === pixels[i + channel])) {
        continue;
      }
      writes.push({
        x: (i / 4) % this.model.width,
        y: Math.floor(i / 4 / this.model.width),
        rgba: [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]],
      });
      // A full maximum document fits within the shared 1 MiB batch bound in chunks.
      if (writes.length === 8000) {
        await send();
      }
    }
    await send();
    return this.candidate;
  }
  checkpoint() {
    const pixels = this.model.pixels.slice();
    return this.serialize(async () => {
      const candidate = await this.synchronize(pixels);
      if (encoded(pixels) === this.checkpointPixels) {
        return;
      }
      const ack = await this.api('artwork-draft-write', record, {
        id: this.id,
        owner: this.owner,
        revision: this.revision,
        project_id: candidate.project_id,
        name: candidate.descriptor.name,
        original: this.original,
        candidate,
      });
      this.revision = string(ack.revision);
      this.checkpointPixels = encoded(pixels);
    });
  }
  synchronizeCurrent() {
    const pixels = this.model.pixels.slice();
    return this.serialize(() => this.synchronize(pixels));
  }
  async removeCheckpoint() {
    await this.queue.catch(() => undefined);
    if (this.revision) {
      await this.api('artwork-draft-delete', record, {
        id: this.id,
        revision: this.revision,
        owner: this.owner,
      });
    }
  }
  async settled() {
    await this.queue.catch(() => undefined);
  }
}
