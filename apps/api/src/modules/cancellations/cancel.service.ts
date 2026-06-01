import { prisma } from '../../prisma.js';
import { Errors } from '../../errors.js';
import { logger } from '../../logger.js';
import { transitionBooking } from '../../state/booking.transitions.js';
import { enqueueNotification } from '../notifications/notifications.service.js';
import { createRefund, isRazorpayConfigured } from '../payments/razorpay.js';
import { computeCancellation } from './policy.js';
import type { CancellationPreview, CancellationSummary } from '@aero/types';

const CANCELLABLE = new Set(['PENDING', 'CONFIRMED']);

async function loadOwnedBooking(userId: string, bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true, cancellation: true },
  });
  if (!booking || booking.userId !== userId) throw Errors.notFound('Booking not found');
  return booking;
}

/** Sum of successfully captured TOKEN payments, in paise. */
function tokenPaidOf(payments: { type: string; status: string; amountPaid: number }[]): number {
  return payments
    .filter((p) => p.type === 'TOKEN' && p.status === 'SUCCESS')
    .reduce((sum, p) => sum + p.amountPaid, 0);
}

export async function previewCancellation(userId: string, bookingId: string): Promise<CancellationPreview> {
  const booking = await loadOwnedBooking(userId, bookingId);

  if (booking.cancellation) {
    return { eligible: false, reason: 'Booking is already cancelled' };
  }
  if (!CANCELLABLE.has(booking.status)) {
    return { eligible: false, reason: `Booking in ${booking.status} state cannot be cancelled` };
  }

  const tokenPaid = tokenPaidOf(booking.payments);
  const q = computeCancellation(tokenPaid, booking.createdAt, booking.scheduledAt);
  return {
    eligible: true,
    bucket: q.bucket,
    feeAmount: q.feeAmount,
    refundAmount: q.refundAmount,
    explanation: q.explanation,
    tokenPaid,
  };
}

export async function cancelBooking(
  userId: string,
  bookingId: string,
  reason: string,
): Promise<CancellationSummary> {
  const booking = await loadOwnedBooking(userId, bookingId);

  // Idempotent: return the existing cancellation if already cancelled.
  if (booking.cancellation) {
    const existingRefund = booking.cancellation.refundId
      ? await prisma.refund.findUnique({ where: { id: booking.cancellation.refundId } })
      : null;
    return {
      bucket: booking.cancellation.policyBucket as CancellationSummary['bucket'],
      feeAmount: booking.cancellation.feeAmount,
      refundAmount: booking.cancellation.refundAmount,
      refundStatus: (existingRefund?.status as CancellationSummary['refundStatus']) ?? null,
    };
  }

  if (!CANCELLABLE.has(booking.status)) {
    throw Errors.conflict(`Booking in ${booking.status} state cannot be cancelled`);
  }

  const tokenPaid = tokenPaidOf(booking.payments);
  const q = computeCancellation(tokenPaid, booking.createdAt, booking.scheduledAt);

  // Persist the cancellation and flip booking state atomically.
  await prisma.cancellation.create({
    data: {
      bookingId: booking.id,
      cancelledBy: 'CUSTOMER',
      reason,
      policyBucket: q.bucket,
      feeAmount: q.feeAmount,
      refundAmount: q.refundAmount,
    },
  });
  await transitionBooking(booking.id, 'CANCELLED', { actorId: userId, reason });

  // Initiate refund against the captured TOKEN payment, if any is owed.
  let refundStatus: CancellationSummary['refundStatus'] = null;
  const tokenPayment = booking.payments.find(
    (p) => p.type === 'TOKEN' && p.status === 'SUCCESS' && p.gatewayPayId,
  );

  if (q.refundAmount > 0 && tokenPayment?.gatewayPayId) {
    if (!isRazorpayConfigured()) {
      logger.warn({ bookingId: booking.id }, 'refund_skipped_razorpay_unconfigured');
    } else {
      try {
        const rzpRefund = await createRefund({
          paymentId: tokenPayment.gatewayPayId,
          amount: q.refundAmount,
          notes: { bookingId: booking.id, bookingCode: booking.code },
        });
        const refund = await prisma.refund.create({
          data: {
            paymentId: tokenPayment.id,
            amount: q.refundAmount,
            status: 'PENDING',
            gatewayRefundId: rzpRefund.id,
            reason,
            initiatedBy: 'CUSTOMER',
          },
        });
        await prisma.cancellation.update({
          where: { bookingId: booking.id },
          data: { refundId: refund.id },
        });
        refundStatus = 'PENDING';
      } catch (err) {
        logger.error({ err, bookingId: booking.id }, 'refund_initiation_failed');
        // Booking stays cancelled; refund can be retried by ops.
      }
    }
  }

  void enqueueNotification(booking.id, 'cancellation_confirmed', { refundAmount: q.refundAmount });

  return {
    bucket: q.bucket,
    feeAmount: q.feeAmount,
    refundAmount: q.refundAmount,
    refundStatus,
  };
}

/**
 * Platform-initiated cancellation when no driver could be assigned by pickup
 * time (Phase 4 §6.4 / §8.5). Full token refund, zero fee. Idempotent.
 */
export async function systemCancelBookingNoDriver(bookingId: string): Promise<{ cancelled: boolean }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true, cancellation: true },
  });
  if (!booking) return { cancelled: false };
  if (booking.cancellation || booking.status !== 'CONFIRMED') return { cancelled: false };

  const tokenPaid = tokenPaidOf(booking.payments);

  await prisma.cancellation.create({
    data: {
      bookingId: booking.id,
      cancelledBy: 'OPS',
      reason: 'no_driver_available',
      policyBucket: 'GRACE_30_MIN',
      feeAmount: 0,
      refundAmount: tokenPaid,
    },
  });
  await transitionBooking(booking.id, 'CANCELLED', { reason: 'no_driver_available' });

  const tokenPayment = booking.payments.find(
    (p) => p.type === 'TOKEN' && p.status === 'SUCCESS' && p.gatewayPayId,
  );
  if (tokenPaid > 0 && tokenPayment?.gatewayPayId) {
    if (!isRazorpayConfigured()) {
      logger.warn({ bookingId: booking.id }, 'auto_refund_skipped_razorpay_unconfigured');
    } else {
      try {
        const rzpRefund = await createRefund({
          paymentId: tokenPayment.gatewayPayId,
          amount: tokenPaid,
          notes: { bookingId: booking.id, bookingCode: booking.code, reason: 'no_driver' },
        });
        const refund = await prisma.refund.create({
          data: {
            paymentId: tokenPayment.id,
            amount: tokenPaid,
            status: 'PENDING',
            gatewayRefundId: rzpRefund.id,
            reason: 'no_driver_available',
            initiatedBy: 'OPS',
          },
        });
        await prisma.cancellation.update({
          where: { bookingId: booking.id },
          data: { refundId: refund.id },
        });
      } catch (err) {
        logger.error({ err, bookingId: booking.id }, 'auto_refund_initiation_failed');
      }
    }
  }

  return { cancelled: true };
}
