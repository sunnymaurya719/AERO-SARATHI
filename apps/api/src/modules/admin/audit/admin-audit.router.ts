import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { requirePermission } from '../../../rbac/middleware.js';
import { readAuditEvents, type AuditQuery } from '../../../middleware/audit.js';

export const adminAuditRouter: ExpressRouter = Router();

adminAuditRouter.get('/', requirePermission('audit.view'), async (req, res, next) => {
  try {
    const q = req.query as Record<string, unknown>;
    const query: AuditQuery = {
      entityType: typeof q.entityType === 'string' ? q.entityType : undefined,
      entityId: typeof q.entityId === 'string' ? q.entityId : undefined,
      actorId: typeof q.actorId === 'string' ? q.actorId : undefined,
      action: typeof q.action === 'string' ? q.action : undefined,
      from: typeof q.from === 'string' ? new Date(q.from) : undefined,
      to: typeof q.to === 'string' ? new Date(q.to) : undefined,
      cursor: typeof q.cursor === 'string' ? q.cursor : undefined,
      limit: Math.min(Number(q.limit) || 50, 100),
    };
    res.status(200).json(await readAuditEvents(query));
  } catch (err) {
    next(err);
  }
});
