import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { Prisma } from '@aero/db';
import { prisma } from '../../../prisma.js';
import { Errors } from '../../../errors.js';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import { webhookQueue } from '../../../queues/index.js';
import { makeLimiter } from '../../../middleware/rate-limit.js';
import type { Request, Response, NextFunction } from 'express';

export const adminWebhooksRouter: ExpressRouter = Router();

// 10 replays / minute / admin.
const consumeReplay = makeLimiter({ keyPrefix: 'admin:webhook-replay', points: 10, durationSec: 60 });
async function replayLimit(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    await consumeReplay((req as AdminRequest).admin!.id);
    next();
  } catch (err) {
    next(err);
  }
}

adminWebhooksRouter.get('/', requirePermission('webhooks.view'), async (req, res, next) => {
  try {
    const q = req.query as Record<string, unknown>;
    const where: Prisma.WebhookEventWhereInput = {};
    if (typeof q.eventType === 'string') where.eventType = q.eventType;
    if (q.status === 'processed') where.processedAt = { not: null };
    if (q.status === 'pending') where.processedAt = null;
    if (q.status === 'failed') where.processingError = { not: null };
    const limit = Math.min(Number(q.limit) || 50, 100);
    const cursor = typeof q.cursor === 'string' ? q.cursor : undefined;

    const rows = await prisma.webhookEvent.findMany({
      where,
      orderBy: { receivedAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, gateway: true, eventId: true, eventType: true,
        processedAt: true, processingError: true, receivedAt: true,
      },
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    res.status(200).json({ items, nextCursor: hasMore ? (rows[limit - 1]?.id ?? null) : null });
  } catch (err) {
    next(err);
  }
});

adminWebhooksRouter.get('/:id', requirePermission('webhooks.view'), async (req, res, next) => {
  try {
    const event = await prisma.webhookEvent.findUnique({ where: { id: String(req.params.id) } });
    if (!event) throw Errors.notFound('Webhook event not found');
    res.status(200).json(event);
  } catch (err) {
    next(err);
  }
});

adminWebhooksRouter.post('/:id/replay', requirePermission('webhooks.replay'), replayLimit, async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const event = await prisma.webhookEvent.findUnique({ where: { id }, select: { id: true } });
    if (!event) throw Errors.notFound('Webhook event not found');
    await webhookQueue.add('replay', { webhookEventId: id }, { jobId: `replay:${id}:${Date.now()}` });
    await audit({ req: req as AdminRequest, action: 'webhook.replay', entity: { type: 'WebhookEvent', id } });
    res.status(202).json({ replayed: true });
  } catch (err) {
    next(err);
  }
});
