import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import {
  listAdminUsers,
  inviteAdmin,
  disableAdmin,
  enableAdmin,
  changeRole,
  reset2fa,
} from './admin-users.service.js';

export const adminUsersRouter: ExpressRouter = Router();

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'] as const;

adminUsersRouter.get('/', requirePermission('users.manage'), async (_req, res, next) => {
  try {
    res.status(200).json(await listAdminUsers());
  } catch (err) {
    next(err);
  }
});

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
});

adminUsersRouter.post('/invite', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const input = InviteSchema.parse(req.body);
    const result = await inviteAdmin({ ...input, invitedById: (req as AdminRequest).admin!.id });
    await audit({ req: req as AdminRequest, action: 'user.invite', entity: { type: 'AdminUser', id: input.email, code: input.role }, after: { email: input.email, role: input.role } });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.post('/:id/disable', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await disableAdmin(id, (req as AdminRequest).admin!.id);
    await audit({ req: req as AdminRequest, action: 'user.disable', entity: { type: 'AdminUser', id } });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.post('/:id/enable', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await enableAdmin(id);
    await audit({ req: req as AdminRequest, action: 'user.enable', entity: { type: 'AdminUser', id } });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

const RoleSchema = z.object({ role: z.enum(ROLES) });

adminUsersRouter.post('/:id/role', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const { role } = RoleSchema.parse(req.body);
    const id = String(req.params.id);
    const result = await changeRole(id, role, (req as AdminRequest).admin!.id);
    await audit({ req: req as AdminRequest, action: 'user.changeRole', entity: { type: 'AdminUser', id }, after: { role } });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

adminUsersRouter.post('/:id/reset-2fa', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const result = await reset2fa(id);
    await audit({ req: req as AdminRequest, action: 'user.reset2fa', entity: { type: 'AdminUser', id } });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
