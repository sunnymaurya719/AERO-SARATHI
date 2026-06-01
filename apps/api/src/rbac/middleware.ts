import type { Request, Response, NextFunction } from 'express';
import type { AdminRole } from '@aero/db';
import { Errors } from '../errors.js';
import { can, type Permission } from './matrix.js';
import type { AdminRequest } from '../middleware/admin-session.js';

/** Allow the request only if the admin holds one of the given roles. */
export function rbac(...allowed: AdminRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = (req as AdminRequest).admin?.role;
    if (!role) return next(Errors.unauthorized());
    if (!allowed.includes(role)) return next(Errors.forbidden());
    next();
  };
}

/** Allow the request only if the admin's role satisfies a named permission. */
export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = (req as AdminRequest).admin?.role;
    if (!role) return next(Errors.unauthorized());
    if (!can(role, permission)) return next(Errors.forbidden());
    next();
  };
}

// Convenience guards.
export const opsPlus = rbac('OPS', 'ADMIN', 'SUPER_ADMIN');
export const financePlus = rbac('FINANCE', 'ADMIN', 'SUPER_ADMIN');
export const adminPlus = rbac('ADMIN', 'SUPER_ADMIN');
export const superOnly = rbac('SUPER_ADMIN');
