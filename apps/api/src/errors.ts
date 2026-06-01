/** Application error mapped to an RFC 7807 problem-details response. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly detail: string,
    public readonly errors?: unknown[],
  ) {
    super(detail);
    this.name = 'AppError';
  }
}

export const Errors = {
  validation: (detail: string, errors?: unknown[]) =>
    new AppError('ValidationError', 400, detail, errors),
  unauthorized: (detail = 'Authentication required') =>
    new AppError('Unauthorized', 401, detail),
  forbidden: (detail = 'Forbidden') => new AppError('Forbidden', 403, detail),
  notFound: (detail = 'Not found') => new AppError('NotFound', 404, detail),
  conflict: (detail = 'Conflict') => new AppError('Conflict', 409, detail),
  gone: (detail = 'Resource expired') => new AppError('Gone', 410, detail),
  tooMany: (detail = 'Too many requests') => new AppError('TooManyRequests', 429, detail),
  badGateway: (detail = 'Upstream service error') => new AppError('BadGateway', 502, detail),
};
