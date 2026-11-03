/** One artwork document, its serial checkpoint writer, and exact saved-base ownership. */
import type { ProjectApi } from '../project/project-api.mts';
import { record, string, array } from '../shared/decode.mts';
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
  private checkpointLayout = '';
  private checkpointAttempted = false;
  private checkpointUncertain = false;
  private pendingCheckpoints = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private api: ProjectApi['json'];
  constructor(candidate: Candidate, api: ProjectApi['json'], original = candidate) {
    this.api = api;
    this.candidate = candidate;
    this.original = original;
    this.model = new PixelModel(candidate);
  }
  get changed() {
    return (
      this.original.operation !== 'edit' ||
      encoded(this.model.pixels) !== this.original.rgba ||
      JSON.stringify(this.model.descriptor) !== JSON.stringify(this.original.descriptor)
    );
  }
  get uncheckpointed() {
    return (
      this.pendingCheckpoints > 0 ||
      this.checkpointUncertain ||
      ((this.changed || this.checkpointAttempted) &&
        (encoded(this.model.pixels) !== this.checkpointPixels ||
          JSON.stringify(this.model.descriptor) !== this.checkpointLayout))
    );
  }
  invalidate() {
    this.receipt = null;
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(work);
    this.queue = next;
    return next;
  }
  private async synchronize(pixels: Uint8ClampedArray, descriptor: Candidate['descriptor']) {
    if (
      descriptor.version === 2 &&
      JSON.stringify(descriptor) !== JSON.stringify(this.candidate.descriptor)
    ) {
      this.candidate = await this.api('artwork-layout', decodeCandidate, {
        candidate: this.candidate,
        frames: descriptor.frames,
        sequences: descriptor.sequences,
      });
    }
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
  checkpoint(snapshot = this.model.pixels) {
    const pixels = snapshot.slice();
    const descriptor = structuredClone(this.model.descriptor);
    // Undo can return to the saved base while an older checkpoint is still queued.
    this.pendingCheckpoints++;
    return this.serialize(async () => {
      if (this.checkpointUncertain) {
        await this.inspectCheckpoint();
      }
      const candidate = await this.synchronize(pixels, descriptor);
      if (
        encoded(pixels) === this.checkpointPixels &&
        JSON.stringify(descriptor) === this.checkpointLayout
      ) {
        return;
      }
      this.checkpointAttempted = true;
      // A failed response cannot tell us whether this write reached disk.
      this.checkpointUncertain = true;
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
      this.checkpointLayout = JSON.stringify(descriptor);
      this.checkpointUncertain = false;
    }).finally(() => {
      this.pendingCheckpoints--;
    });
  }
  synchronizeCurrent() {
    const pixels = this.model.pixels.slice();
    const descriptor = structuredClone(this.model.descriptor);
    return this.serialize(() => this.synchronize(pixels, descriptor));
  }
  private async inspectCheckpoint() {
    // Any checkpoint may have committed without a response. Inspect our exact
    // identity and guarded bytes before another write or explicit cleanup.
    const listing = await this.api('artwork-draft-list', record, {});
    const own = array(listing.drafts, record).find((draft) => draft.id === this.id);
    if (own) {
      if (own.owner !== this.owner) {
        throw Error('The checkpoint belongs to another owner. Inspect recovery before continuing.');
      }
      const revision = string(own.revision);
      const draft = await this.api('artwork-draft-download', record, { id: this.id, revision });
      const candidate = decodeCandidate(draft.candidate);
      this.checkpointPixels = candidate.rgba;
      this.checkpointLayout = JSON.stringify(candidate.descriptor);
      this.revision = revision;
    } else {
      this.revision = null;
      this.checkpointPixels = '';
      this.checkpointLayout = '';
    }
    this.checkpointUncertain = false;
  }
  async removeCheckpoint() {
    await this.queue.catch(() => undefined);
    if (this.checkpointUncertain) {
      await this.inspectCheckpoint();
    }
    if (this.revision) {
      await this.api('artwork-draft-delete', record, {
        id: this.id,
        revision: this.revision,
        owner: this.owner,
      });
    }
    this.revision = null;
    this.checkpointPixels = '';
    this.checkpointLayout = '';
    this.checkpointAttempted = false;
    this.checkpointUncertain = false;
  }
}
