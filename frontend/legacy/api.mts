import { HttpError, ProtocolError, errorDetails } from '../errors.mts';
import type { Decoder } from './decode.mts';
import { record } from './decode.mts';
import type { ApiRoute, MutationRequests } from './types.ts';
export { HttpError, ProtocolError, errorDetails } from '../errors.mts';

export interface RequestOptions {
  timeoutMs?: number;
}
type RequestArgs<P extends ApiRoute> = P extends keyof MutationRequests
  ? [data: MutationRequests[P], options?: RequestOptions]
  : [data?: undefined, options?: RequestOptions];

export class ApiClient {
  token = '';

  /** Downloads are fully read before the deadline is released. */
  request<P extends ApiRoute>(path: P, ...args: RequestArgs<P>): Promise<Blob> {
    return this.consume(path, (response) => response.blob(), args[0], args[1]);
  }

  private async consume<T>(
    path: string,
    read: (response: Response) => Promise<T>,
    data?: object,
    options: RequestOptions = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = options.timeoutMs
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : null;
    try {
      const response = await fetch('/api/' + path, {
        signal: controller.signal,
        ...(data === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Scene-Token': this.token },
              body: JSON.stringify(data),
            }),
      });
      if (!response.ok) {
        let message = `Editor returned HTTP ${response.status} ${response.statusText}`;
        try {
          const result = record(await response.json());
          if (typeof result.error === 'string' && result.error) {
            message = result.error;
          }
        } catch (error) {
          // An aborted error body is still a timeout, not a completed HTTP response.
          if (controller.signal.aborted) {
            throw error;
          }
        }
        throw new HttpError(message, response.status);
      }
      return await read(response);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HttpError(
          `The editor server did not respond within ${Number(options.timeoutMs) / 1000} seconds.`,
        );
      }
      throw errorDetails(error);
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
    }
  }

  json<P extends ApiRoute, T>(path: P, decode: Decoder<T>, ...args: RequestArgs<P>): Promise<T> {
    return this.consume(
      path,
      async (response) => {
        let value: unknown;
        try {
          value = await response.json();
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new ProtocolError(`Invalid JSON from ${path}`);
          }
          throw error;
        }
        try {
          return decode(value);
        } catch (error) {
          throw new ProtocolError(`Invalid response from ${path}: ${errorDetails(error).message}`);
        }
      },
      args[0],
      args[1],
    );
  }
}
