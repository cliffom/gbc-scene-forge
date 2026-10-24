import type { Decoder } from './decode.mts';
import { record } from './decode.mts';
import type { ApiRoute, MutationRequests } from './types.ts';

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}
export function errorDetails(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  return new HttpError(error instanceof Error ? error.message : String(error));
}
export interface RequestOptions {
  timeoutMs?: number;
}
type RequestArgs<P extends ApiRoute> = P extends keyof MutationRequests
  ? [data: MutationRequests[P], options?: RequestOptions]
  : [data?: undefined, options?: RequestOptions];

export class ApiClient {
  token = '';

  request<P extends ApiRoute>(path: P, ...args: RequestArgs<P>): Promise<Response> {
    return this.send(path, args[0], args[1]);
  }

  private async send(path: string, data?: object, options: RequestOptions = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = options.timeoutMs
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : null;
    let response: Response;
    try {
      response = await fetch('/api/' + path, {
        signal: controller.signal,
        ...(data === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Scene-Token': this.token },
              body: JSON.stringify(data),
            }),
      });
    } catch (error) {
      throw new HttpError(
        error instanceof Error && error.name === 'AbortError'
          ? `The editor server did not respond within ${Number(options.timeoutMs) / 1000} seconds.`
          : errorDetails(error).message,
      );
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
    if (!response.ok) {
      let message = `Editor returned HTTP ${response.status} ${response.statusText}`;
      try {
        const result = record(await response.json());
        if (typeof result.error === 'string' && result.error) {
          message = result.error;
        }
      } catch {
        /* Keep the HTTP error when the response is not JSON. */
      }
      throw new HttpError(message, response.status);
    }
    return response;
  }

  async json<P extends ApiRoute, T>(
    path: P,
    decode: Decoder<T>,
    ...args: RequestArgs<P>
  ): Promise<T> {
    const response = await this.send(path, args[0], args[1]);
    const value: unknown = await response.json();
    return decode(value);
  }
}
