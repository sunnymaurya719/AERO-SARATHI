import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { redis } from '../redis.js';
import { Errors } from '../errors.js';
import type { Role } from '@aero/db';

/** Requires a valid, non-denylisted access token. Populates req.user. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization');
    const cookieToken = req.cookies?.['__Host-aero_at'] as string | undefined;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : cookieToken;
    if (!token) throw Errors.unauthorized();

    const payload = await verifyAccessToken(token);
    const denied = await redis.get(`jwt:denylist:${payload.jti}`);
    if (denied) throw Errors.unauthorized('Token revoked');

    req.user = { id: payload.sub, role: payload.role, jti: payload.jti };
    next();
  } catch (err) {
    next(err instanceof Error && err.name === 'AppError' ? err : Errors.unauthorized('Invalid token'));
  }
}

/** Requires the authenticated user to hold one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(Errors.unauthorized());
    if (!roles.includes(req.user.role)) return next(Errors.forbidden());
    next();
  };
}
