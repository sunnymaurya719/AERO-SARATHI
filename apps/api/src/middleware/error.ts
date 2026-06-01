import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@aero/db';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import type { ProblemDetails } from '@aero/types';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let problem: ProblemDetails;

  if (err instanceof AppError) {
    problem = { type: 'about:blank', title: err.code, status: err.status, detail: err.detail, errors: err.errors };
  } else if (err instanceof ZodError) {
    problem = {
      type: 'about:blank',
      title: 'ValidationError',
      status: 400,
      detail: 'Request validation failed',
      errors: err.issues,
    };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    problem = { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Resource already exists' };
  } else {
    logger.error({ err, reqId: req.id }, 'unhandled_error');
    problem = { type: 'about:blank', title: 'InternalServerError', status: 500, detail: 'Something went wrong' };
  }

  res.status(problem.status).type('application/problem+json').json(problem);
}
