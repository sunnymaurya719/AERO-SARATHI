import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { idempotency } from '../../middleware/idempotency.js';
import { writeEvent } from '../../analytics/events.js';
import { previewCancellation, cancelBooking } from './cancel.service.js';

export const cancelRouter: ExpressRouter = Router();

const CancelSchema = z.object({
  reason: z.string().min(8, 'Please tell us why (at least 8 characters)').max(500),
  confirm: z.literal(true),
});

cancelRouter.get('/:id/cancel/preview', requireAuth, async (req, res, next) => {
  try {
    const preview = await previewCancellation(req.user!.id, String(req.params.id));
    res.status(200).json(preview);
  } catch (err) {
    next(err);
  }
});

cancelRouter.post('/:id/cancel', requireAuth, idempotency, async (req, res, next) => {
  try {
    const body = CancelSchema.parse(req.body);
    const summary = await cancelBooking(req.user!.id, String(req.params.id), body.reason);
    void writeEvent('booking_created', { bookingId: req.params.id, stage: 'cancelled', bucket: summary.bucket }, { userId: req.user!.id });
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
});
