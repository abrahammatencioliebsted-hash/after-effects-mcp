import type { ApiError } from '@mc/contracts';

/** Error de dominio con forma de `ApiError`; `app.ts` lo traduce a JSON. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiError['code'],
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  toApiError(): ApiError {
    const body: ApiError = { error: this.message, code: this.code };
    if (this.details !== undefined) body.details = this.details;
    return body;
  }
}

export const notFound = (what: string, id?: string): HttpError =>
  new HttpError(404, 'not_found', id ? `${what} no encontrado: ${id}` : `${what} no encontrado`);

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, 'invalid_request', message, details);

export const unauthorized = (message = 'Falta o es inválido el token Bearer'): HttpError =>
  new HttpError(401, 'unauthorized', message);

export const conflict = (message: string, details?: unknown): HttpError =>
  new HttpError(409, 'conflict', message, details);

export const simulatedOnly = (message: string): HttpError =>
  new HttpError(501, 'simulated_only', message);
