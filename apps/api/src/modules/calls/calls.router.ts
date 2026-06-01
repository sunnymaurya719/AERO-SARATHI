import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { placeMaskedCall } from './call-mask.service.js';

/** Passenger-facing masked-call connect. Mounted at /api/v1/calls. */
export const callsRouter: ExpressRouter = Router();

const ConnectSchema = z.object({ bookingId: z.string().min(1).max(64) });

callsRouter.post('/connect', requireAuth, async (req, res, next) => {
  try {
    const { bookingId } = ConnectSchema.parse(req.body);
    const result = await placeMaskedCall({ bookingId, fromRole: 'PASSENGER', actorId: req.user!.id });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
