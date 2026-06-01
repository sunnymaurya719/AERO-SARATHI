import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { idempotency } from '../../middleware/idempotency.js';
import { writeEvent } from '../../analytics/events.js';
import { createPaymentIntent, verifyPayment } from './payments.service.js';

export const paymentsRouter: ExpressRouter = Router();

const VerifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

paymentsRouter.post('/:id/payment/intent', requireAuth, idempotency, async (req, res, next) => {
  try {
    const intent = await createPaymentIntent(req.user!.id, String(req.params.id));
    void writeEvent('booking_created', { bookingId: intent.notes.bookingId, stage: 'payment_intent' }, { userId: req.user!.id });
    res.status(200).json(intent);
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post('/:id/payment/verify', requireAuth, idempotency, async (req, res, next) => {
  try {
    const body = VerifySchema.parse(req.body);
    const result = await verifyPayment(req.user!.id, String(req.params.id), body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
