/** One artwork document, its serial checkpoint writer, and exact saved-base ownership. */
import { MAX_PIXEL_PATCH_PIXELS } from './artwork-limits.mts';
import type { ProjectApi } from '../project/project-api.mts';
import { record, string, array } from '../shared/decode.mts';
import { bytes, encoded, PixelModel } from './pixel-model.mts';
import { decodeCandidate, type Candidate } from './artwork-contracts.mts';

// Two aggregate document baselines (saved and checkpoint), <=16 MiB each.
// This bounds decoded bytes, independently of document count or raster count.
const MAX_BASELINE_BYTES = 32 * 1024 * 1024;
// Two sets of up to eight sources plus a composite; also bound small-entry overhead.
const MAX_BASELINE_ENTRIES = 18;

export class ArtworkSession {
  readonly model: PixelModel;
  original: Candidate;
  candidate: Candidate;
  externalChanged = false;
  receipt: Record<string, unknown> | null = null;
  readonly id = crypto.randomUUID();
  readonly owner = crypto.randomUUID();
  revision: string | null = null;
  checkpointPixels = '';
  private checkpointLayers: Record<string, string> | undefined;
  private checkpointLayout = '';
  private checkpointAttempted = false;
  private checkpointUncertain = false;
  private pendingCheckpoints = 0;
  private queue: Promise<unknown> = Promise.resolve();
  // Saved/checkpoint layer sources share a byte-bounded LRU. Cache baselines,
  // never dirty state: callers may mutate bytes directly or replace history.
  private pixelBases = new Map<string, Uint8ClampedArray>();
  private pixelBaseBytes = 0;
  private matches(pixels: Uint8ClampedArray, rgba: string) {
    let previous = this.pixelBases.get(rgba);
    if (!previous) {
      previous = bytes(rgba);
      while (
        (this.pixelBaseBytes + previous.byteLength > MAX_BASELINE_BYTES ||
          this.pixelBases.size >= MAX_BASELINE_ENTRIES) &&
        this.pixelBases.size
      ) {
        const oldest = this.pixelBases.entries().next().value;
        if (!oldest) {
          break;
        }
        this.pixelBaseBytes -= oldest[1].byteLength;
        this.pixelBases.delete(oldest[0]);
      }
      this.pixelBaseBytes += previous.byteLength;
    }
    this.pixelBases.delete(rgba);
    this.pixelBases.set(rgba, previous);
    if (previous.length !== pixels.length) {
      return false;
    }
    for (let i = 0; i < pixels.length; i++) {
      if (previous[i] !== pixels[i]) {
        return false;
      }
    }
    return true;
  }
  private api: ProjectApi['json'];
  constructor(candidate: Candidate, api: ProjectApi['json'], original = candidate) {
    this.api = api;
    this.candidate = candidate;
    this.original = original;
    this.model = new PixelModel(candidate);
  }
  adoptSaved(candidate: Candidate) {
    this.model.retainSavedFrames(candidate.descriptor);
    this.candidate = candidate;
    this.original = candidate;
    this.externalChanged = false;
    this.receipt = null;
  }
  downloadWork() {
    return {
      original: structuredClone(this.original),
      candidate: structuredClone(this.candidate),
      current_descriptor: structuredClone(this.model.descriptor),
      current_rgba: encoded(this.model.composite()),
      layer_rgba: this.model.descriptor.layers ? this.model.layerEncoding() : undefined,
      width: this.model.width,
      height: this.model.height,
    };
  }
  private layersMatch(value: Record<string, string> | undefined) {
    if (!this.model.descriptor.layers) {
      return !value;
    }
    if (!value) {
      return false;
    }
    return this.model.layersMatch(value, (pixels, raw) => this.matches(pixels, raw));
  }
  get changed() {
    return (
      this.original.operation !== 'edit' ||
      JSON.stringify(this.model.descriptor) !== JSON.stringify(this.original.descriptor) ||
      !this.layersMatch(this.original.layer_rgba) ||
      // Layer sources plus their descriptor fully determine the canonical composite.
      (!this.model.descriptor.layers && !this.matches(this.model.pixels, this.original.rgba))
    );
  }
  get uncheckpointed() {
    return (
      this.pendingCheckpoints > 0 ||
      this.checkpointUncertain ||
      ((this.changed || this.checkpointAttempted) &&
        (JSON.stringify(this.model.descriptor) !== this.checkpointLayout ||
          !this.layersMatch(this.checkpointLayers) ||
          (!this.model.descriptor.layers &&
            !this.matches(this.model.pixels, this.checkpointPixels))))
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
  private async synchronize(
    pixels: Uint8ClampedArray,
    descriptor: Candidate['descriptor'],
    layerPixels?: Record<string, string>,
  ) {
    const sourcesChanged =
      JSON.stringify(layerPixels) !== JSON.stringify(this.candidate.layer_rgba);
    const structureChanged =
      JSON.stringify(descriptor.layers) !== JSON.stringify(this.candidate.descriptor.layers);
    if (
      (sourcesChanged || structureChanged) &&
      this.candidate.descriptor.layers?.items.some((item) => item.locked)
    ) {
      // Local Undo may coalesce unlock plus older edits before the next checkpoint.
      // Stage the explicit unlock before replaying that owned immutable snapshot.
      this.candidate = await this.api('artwork-layers', decodeCandidate, {
        candidate: this.candidate,
        layers: this.candidate.descriptor.layers.items.map((item) => ({ ...item, locked: false })),
      });
    }
    if (!descriptor.layers && this.candidate.descriptor.layers) {
      this.candidate = await this.api('artwork-layers', decodeCandidate, {
        candidate: this.candidate,
        layers: [],
      });
    }
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
    if (descriptor.layers && layerPixels) {
      if (!sourcesChanged && !structureChanged) {
        return this.candidate;
      }
      const unlocked = descriptor.layers.items.map((item) => ({ ...item, locked: false }));
      if (JSON.stringify(unlocked) !== JSON.stringify(this.candidate.descriptor.layers?.items)) {
        this.candidate = await this.api('artwork-layers', decodeCandidate, {
          candidate: this.candidate,
          layers: unlocked,
        });
      }
      this.candidate = await this.api('artwork-layer-sync', decodeCandidate, {
        candidate: this.candidate,
        layer_rgba: layerPixels,
      });
      if (descriptor.layers.items.some((item) => item.locked)) {
        this.candidate = await this.api('artwork-layers', decodeCandidate, {
          candidate: this.candidate,
          layers: descriptor.layers.items,
        });
      }
      return this.candidate;
    }
    const previous = bytes(this.candidate.rgba);
    if (pixels.length > MAX_PIXEL_PATCH_PIXELS * 4) {
      let handle: Record<string, unknown> | null = null;
      try {
        const rowsPerChunk = Math.floor(MAX_PIXEL_PATCH_PIXELS / this.model.width);
        for (let y = 0; y < this.model.height; y += rowsPerChunk) {
          const height = Math.min(rowsPerChunk, this.model.height - y);
          const start = y * this.model.width * 4,
            end = start + height * this.model.width * 4;
          let different = false;
          for (let i = start; i < end; i++) {
            if (previous[i] !== pixels[i]) {
              different = true;
              break;
            }
          }
          if (!different) {
            continue;
          }
          handle ??= await this.api('artwork-candidate-retain', record, {
            candidate: this.candidate,
            owner: this.owner,
          });
          const next: Record<string, unknown> = await this.api('artwork-edit', record, {
            candidate: handle,
            patch: {
              rectangle: { x: 0, y, width: this.model.width, height },
              rgba: encoded(pixels.subarray(start, end)),
            },
          });
          const old = handle;
          handle = next;
          await this.api('artwork-candidate-release', record, { candidate: old });
        }
      } finally {
        if (handle) {
          this.candidate = await this.api('artwork-candidate-export', decodeCandidate, {
            candidate: handle,
          });
          await this.api('artwork-candidate-release', record, { candidate: handle });
        }
      }
      return this.candidate;
    }
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
      if (
        previous[i] === pixels[i] &&
        previous[i + 1] === pixels[i + 1] &&
        previous[i + 2] === pixels[i + 2] &&
        previous[i + 3] === pixels[i + 3]
      ) {
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
  checkpoint(
    snapshot = this.model.composite(),
    layout = this.model.descriptor,
    layerSnapshot = layout.layers ? this.model.layerEncoding() : undefined,
  ) {
    const pixels = snapshot.slice();
    const descriptor = structuredClone(layout);
    const layerPixels = layerSnapshot;
    // Undo can return to the saved base while an older checkpoint is still queued.
    this.pendingCheckpoints++;
    return this.serialize(async () => {
      if (this.checkpointUncertain) {
        await this.inspectCheckpoint();
      }
      const candidate = await this.synchronize(pixels, descriptor, layerPixels);
      if (
        this.matches(pixels, this.checkpointPixels) &&
        JSON.stringify(layerPixels) === JSON.stringify(this.checkpointLayers) &&
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
      this.checkpointLayers = layerPixels;
      this.checkpointLayout = JSON.stringify(descriptor);
      this.checkpointUncertain = false;
    }).finally(() => {
      this.pendingCheckpoints--;
    });
  }
  synchronizeCurrent() {
    const pixels = this.model.composite().slice();
    const descriptor = structuredClone(this.model.descriptor);
    const layerPixels = descriptor.layers ? this.model.layerEncoding() : undefined;
    return this.serialize(() => this.synchronize(pixels, descriptor, layerPixels));
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
      this.checkpointLayers = candidate.layer_rgba;
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
