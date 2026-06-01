import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import {
  computeRefundable,
  issueManualRefund,
  listRefunds,
  reconcileRefund,
  type RefundListFilters,
} from './admin-refunds.service.js';

export const adminRefundsRouter: ExpressRouter = Router();

function parseFilters(q: Record<string, unknown>): RefundListFilters {
  return {
    status: typeof q.status === 'string' ? q.status : undefined,
    bookingId: typeof q.bookingId === 'string' ? q.bookingId : undefined,
    cursor: typeof q.cursor === 'string' ? q.cursor : undefined,
    limit: Math.min(Number(q.limit) || 50, 100),
  };
}

adminRefundsRouter.get('/', requirePermission('refunds.view'), async (req, res, next) => {
  try {
    res.status(200).json(await listRefunds(parseFilters(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

// Refundable preview for a booking.
adminRefundsRouter.get('/bookings/:id/refundable', requirePermission('refunds.view'), async (req, res, next) => {
  try {
    const { capturedTotal, refundedTotal, refundable } = await computeRefundable(String(req.params.id));
    res.status(200).json({ capturedTotal, refundedTotal, refundable });
  } catch (err) {
    next(err);
  }
});

const RefundSchema = z.object({
  amount: z.number().int().positive(),
  reason: z.string().min(3).max(500),
});

adminRefundsRouter.post('/bookings/:id/refund', requirePermission('refunds.issue'), async (req, res, next) => {
  try {
    const input = RefundSchema.parse(req.body);
    const bookingId = String(req.params.id);
    const role = (req as AdminRequest).admin!.role;
    const initiatedByRole = role === 'OPS' ? 'OPS' : 'ADMIN';
    const result = await issueManualRefund({ bookingId, amount: input.amount, reason: input.reason, initiatedByRole });
    await audit({
      req: req as AdminRequest,
      action: 'refund.issue',
      entity: { type: 'Booking', id: bookingId },
      after: { amount: result.amount, refunds: result.refunds.map((r) => r.id) },
      reason: input.reason,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

const ReconcileSchema = z.object({ note: z.string().min(3).max(500) });

adminRefundsRouter.post('/:id/reconcile', requirePermission('refunds.reconcile'), async (req, res, next) => {
  try {
    const input = ReconcileSchema.parse(req.body);
    const id = String(req.params.id);
    const refund = await reconcileRefund(id, input.note);
    await audit({ req: req as AdminRequest, action: 'refund.reconcile', entity: { type: 'Refund', id }, reason: input.note });
    res.status(200).json(refund);
  } catch (err) {
    next(err);
  }
});
