import type { Decoder } from './decode.mts';
import { record, string } from './decode.mts';
import { HttpError } from './errors.mts';

/** Standalone transport; project routes and acknowledgments stay validated at call sites. */
export class ProjectApi {
  token = '';
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  async request(
    route: string,
    data?: unknown,
    timeout = 30000,
    base = this.base,
  ): Promise<Response> {
    const response = await fetch(`${base}/api/${route}`, {
      method: data === undefined ? 'GET' : 'POST',
      headers:
        data === undefined
          ? {}
          : { 'Content-Type': 'application/json', 'X-Scene-Token': this.token },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok && !(route === 'palette-preflight' && response.status === 422)) {
      const body: unknown = await response.json();
      throw new HttpError(string(record(body).error), response.status);
    }
    return response;
  }
  async json<T>(route: string, decode: Decoder<T>, data?: unknown): Promise<T> {
    return decode(await (await this.request(route, data)).json());
  }
}
