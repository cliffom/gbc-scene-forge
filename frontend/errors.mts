/** Keep incompatible responses distinct from retryable transport failures. */
export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}
export class ProtocolError extends Error {
  readonly status = 0;
}
export function errorDetails(error: unknown): HttpError | ProtocolError {
  if (error instanceof HttpError || error instanceof ProtocolError) {
    return error;
  }
  return new HttpError(error instanceof Error ? error.message : String(error));
}
