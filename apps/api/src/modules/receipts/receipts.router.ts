import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { requireAuth } from '../../middleware/auth.js';
import { Errors } from '../../errors.js';
import { generateReceiptPdf, type ReceiptData } from './receipts.pdf.js';

export const receiptsRouter: ExpressRouter = Router();

receiptsRouter.get('/:id/receipt', requireAuth, async (req, res, next) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: String(req.params.id) },
      include: { payments: { orderBy: { createdAt: 'asc' } }, cancellation: true },
    });
    if (!booking || booking.userId !== req.user!.id) throw Errors.notFound('Booking not found');

    const cacheKey = `receipt:${booking.code}:${booking.updatedAt.getTime()}`;
    const cached = await redis.getBuffer(cacheKey);

    let pdf: Buffer;
    if (cached) {
      pdf = cached;
    } else {
      const data: ReceiptData = {
        code: booking.code,
        status: booking.status,
        passengerName: booking.passengerName,
        passengerPhone: booking.passengerPhone,
        pickup: booking.pickupAddress,
        drop: booking.dropAddress,
        scheduledAt: booking.scheduledAt,
        vehicleCategory: booking.vehicleCategory,
        estimatedKm: booking.estimatedKm,
        estimatedMin: booking.estimatedMin,
        fareTotal: booking.fareTotal,
        tokenAmount: booking.tokenAmount,
        balanceAmount: booking.balanceAmount,
        payments: booking.payments.map((p) => ({
          type: p.type,
          status: p.status,
          method: p.gatewayMethod,
          gatewayPayId: p.gatewayPayId,
          amountPaid: p.amountPaid,
          capturedAt: p.capturedAt,
        })),
        cancellation: booking.cancellation
          ? {
              bucket: booking.cancellation.policyBucket,
              feeAmount: booking.cancellation.feeAmount,
              refundAmount: booking.cancellation.refundAmount,
            }
          : null,
      };
      pdf = await generateReceiptPdf(data);
      await redis.set(cacheKey, pdf, 'EX', 60 * 60 * 24);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${booking.code}-receipt.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    res.status(200).end(pdf);
  } catch (err) {
    next(err);
  }
});
