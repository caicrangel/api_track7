export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError(m, 400, 'BAD_REQUEST', d);
export const unauthorized = (m = 'Não autenticado') => new AppError(m, 401, 'UNAUTHORIZED');
export const forbidden = (m = 'Acesso negado') => new AppError(m, 403, 'FORBIDDEN');
export const notFound = (m = 'Registro não encontrado') => new AppError(m, 404, 'NOT_FOUND');
export const conflict = (m: string) => new AppError(m, 409, 'CONFLICT');
export const upstream = (m: string, d?: unknown) => new AppError(m, 502, 'UPSTREAM_ERROR', d);
