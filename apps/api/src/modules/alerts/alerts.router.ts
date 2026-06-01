import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { AlertStatus } from '@aero/db';
import { requirePermission } from '../../rbac/middleware.js';
import { audit } from '../../middleware/audit.js';
import type { AdminRequest } from '../../middleware/admin-session.js';
import { listAlerts, ackAlert, resolveAlert } from './alerts.service.js';

export const alertsRouter: ExpressRouter = Router();

const STATUSES = ['OPEN', 'ACKED', 'RESOLVED'] as const;

alertsRouter.get('/', requirePermission('alerts.view'), async (req, res, next) => {
  try {
    const statusRaw = req.query.status;
    const status =
      typeof statusRaw === 'string' && (STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as AlertStatus)
        : undefined;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.status(200).json({ items: await listAlerts({ status, limit }) });
  } catch (err) {
    next(err);
  }
});

const IdSchema = z.object({ id: z.string().uuid() });

alertsRouter.post('/:id/ack', requirePermission('alerts.manage'), async (req, res, next) => {
  try {
    const { id } = IdSchema.parse(req.params);
    const admin = (req as AdminRequest).admin!;
    const row = await ackAlert(id, admin.id);
    await audit({ req: req as AdminRequest, action: 'alert.ack', entity: { type: 'SystemAlert', id }, after: row });
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
});

alertsRouter.post('/:id/resolve', requirePermission('alerts.manage'), async (req, res, next) => {
  try {
    const { id } = IdSchema.parse(req.params);
    const row = await resolveAlert(id);
    await audit({ req: req as AdminRequest, action: 'alert.resolve', entity: { type: 'SystemAlert', id }, after: row });
    res.status(200).json(row);
  } catch (err) {
    next(err);
  }
});
