import type { Request, Response, NextFunction } from 'express';
import type { Driver } from '@aero/db';
import { prisma } from '../../prisma.js';
import { Errors } from '../../errors.js';

export interface DriverRequest extends Request {
  driver?: Driver;
}

/**
 * Loads the Driver row for the authenticated user and attaches it to the
 * request. Must run after `requireAuth` + `requireRole('DRIVER')`.
 */
export async function requireDriver(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) return next(Errors.unauthorized());
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) return next(Errors.forbidden('not_a_driver'));
    (req as DriverRequest).driver = driver;
    next();
  } catch (err) {
    next(err);
  }
}
