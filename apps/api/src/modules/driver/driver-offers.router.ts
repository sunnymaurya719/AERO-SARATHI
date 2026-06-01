import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { ipRateLimit } from '../../middleware/rate-limit.js';
import { acceptOffer, declineOffer } from '../assignment/offer.service.js';
import { activeOffers } from './driver-offers.service.js';
import type { DriverRequest } from './driver.middleware.js';

export const driverOffersRouter: ExpressRouter = Router();

driverOffersRouter.get('/active', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    res.status(200).json({ items: await activeOffers(driver.id) });
  } catch (err) {
    next(err);
  }
});

const IdSchema = z.object({ id: z.string().uuid() });
const DeclineSchema = z.object({ reason: z.string().trim().min(8).max(280) });

driverOffersRouter.post(
  '/:id/accept',
  ipRateLimit({ keyPrefix: 'rl:drv:accept', points: 30, durationSec: 60 }),
  async (req, res, next) => {
    try {
      const { id } = IdSchema.parse(req.params);
      const userId = req.user!.id;
      const result = await acceptOffer(id, userId);
      res.status(200).json({ ok: true, bookingId: result.bookingId });
    } catch (err) {
      next(err);
    }
  },
);

driverOffersRouter.post(
  '/:id/decline',
  ipRateLimit({ keyPrefix: 'rl:drv:decline', points: 30, durationSec: 60 }),
  async (req, res, next) => {
    try {
      const { id } = IdSchema.parse(req.params);
      const { reason } = DeclineSchema.parse(req.body);
      const userId = req.user!.id;
      await declineOffer(id, userId, reason);
      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
