import { HttpError } from './errors.mts';

/** Serializes checkpoint writes and cleanup, including edits made during a request. */
export class DraftWriter {
  readonly id = crypto.randomUUID();
  revision: string | null = null;
  private desired: Record<string, unknown> | null = null;
  private saved = '';
  private retryValue: Record<string, unknown> | null | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> = Promise.resolve();
  private stopped = false;
  private send: (route: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>;
  private report: (message: string) => void;
  constructor(
    send: (route: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>,
    report: (message: string) => void,
  ) {
    this.send = send;
    this.report = report;
  }
  observe(value: Record<string, unknown> | null) {
    if (this.stopped) {
      return;
    }
    const key = JSON.stringify(value);
    if (key === JSON.stringify(this.desired) && this.timer) {
      return;
    }
    this.desired = value;
    if (key === this.saved) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, 750);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = this.pending.then(async () => {
      if (this.stopped) {
        return;
      }
      const value = this.retryValue === undefined ? this.desired : this.retryValue;
      const key = JSON.stringify(value);
      if (key === this.saved) {
        return;
      }
      try {
        if (value) {
          const result = await this.send('checkpoint-draft', {
            ...value,
            id: this.id,
            revision: this.revision,
          });
          if (typeof result.revision !== 'string') {
            throw Error('Invalid checkpoint response');
          }
          this.revision = result.revision;
          this.report('Draft checkpoint saved');
        } else if (this.revision) {
          await this.send('delete-draft', { id: this.id, revision: this.revision });
          this.revision = null;
          this.report('');
        }
        this.saved = key;
        this.retryValue = undefined;
      } catch (error) {
        // A rejected request can be replaced by newer edits. An uncertain acknowledgement
        // must replay the same payload so the server can recognize an idempotent retry.
        this.retryValue =
          error instanceof HttpError && error.status >= 400 && error.status < 500
            ? undefined
            : value;
        this.report(
          `Draft recovery unavailable: ${error instanceof Error ? error.message : String(error)}. Save or export your work. Retrying automatically.`,
        );
      }
    });
    return this.pending;
  }
  async clear() {
    clearTimeout(this.timer);
    // Fence queued writes before deleting; a late response cannot recreate a draft.
    this.stopped = true;
    await this.pending;
    if (this.revision) {
      await this.send('delete-draft', { id: this.id, revision: this.revision });
      this.revision = null;
    }
  }
}
