import type { Decoder } from './decode.mts';
import { record, string } from './decode.mts';
import { HttpError } from './errors.mts';

/** Standalone transport; project routes and acknowledgments stay validated at call sites. */
export class ProjectApi {
  token = '';
  readonly base: string;
  private signal: AbortSignal;

  constructor(base: string, signal: AbortSignal = new AbortController().signal) {
    this.base = base;
    this.signal = signal;
  }
  async request(
    route: string,
    data?: unknown,
    timeout = 30000,
    base = this.base,
  ): Promise<Response> {
    this.signal.throwIfAborted();
    const response = await fetch(`${base}/api/${route}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers:
        data === undefined
          ? {}
          : { 'Content-Type': 'application/json', 'X-Scene-Token': this.token },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(timeout)]),
    });
    if (!response.ok && !(route === 'palette-preflight' && response.status === 422)) {
      const body: unknown = await response.json();
      throw new HttpError(string(record(body).error), response.status);
    }
    return response;
  }
  async json<T>(route: string, decode: Decoder<T>, data?: unknown): Promise<T> {
    const value: unknown = await (await this.request(route, data)).json();
    this.signal.throwIfAborted();
    return decode(value);
  }
}
