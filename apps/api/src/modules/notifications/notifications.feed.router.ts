import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { listFeed, unreadCount, markRead, markAllRead } from './notifications.feed.js';

export const notificationsFeedRouter: ExpressRouter = Router();

notificationsFeedRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
    const [feed, unread] = await Promise.all([listFeed(req.user!.id, cursor, limit), unreadCount(req.user!.id)]);
    res.status(200).json({ ...feed, unread });
  } catch (err) {
    next(err);
  }
});

notificationsFeedRouter.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    await markRead(req.user!.id, String(req.params.id));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

notificationsFeedRouter.post('/read-all', requireAuth, async (req, res, next) => {
  try {
    await markAllRead(req.user!.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
