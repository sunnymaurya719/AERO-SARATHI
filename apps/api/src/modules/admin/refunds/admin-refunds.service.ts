import { Prisma } from '@aero/db';
import { prisma } from '../../../prisma.js';
import { Errors } from '../../../errors.js';
import { createRefund as gatewayCreateRefund, isRazorpayConfigured } from '../../payments/razorpay.js';
import { enqueueNotification } from '../../notifications/notifications.service.js';

/** Sum of captured money for a booking minus already-refunded amount. */
export async function computeRefundable(bookingId: string): Promise<{ capturedTotal: number; refundedTotal: number; refundable: number; successPayments: { id: string; gatewayPayId: string | null; amountPaid: number }[] }> {
  const payments = await prisma.payment.findMany({
    where: { bookingId, status: { in: ['SUCCESS', 'PARTIAL_REFUNDED'] }, type: { in: ['TOKEN', 'BALANCE'] } },
    include: { refunds: true },
  });
  let capturedTotal = 0;
  let refundedTotal = 0;
  const successPayments: { id: string; gatewayPayId: string | null; amountPaid: number }[] = [];
  for (const p of payments) {
    capturedTotal += p.amountPaid;
    const refundedOnPayment = p.refunds
      .filter((r) => r.status !== 'FAILED')
      .reduce((s, r) => s + r.amount, 0);
    refundedTotal += refundedOnPayment;
    if (p.amountPaid - refundedOnPayment > 0) {
      successPayments.push({ id: p.id, gatewayPayId: p.gatewayPayId, amountPaid: p.amountPaid - refundedOnPayment });
    }
  }
  return { capturedTotal, refundedTotal, refundable: capturedTotal - refundedTotal, successPayments };
}

export interface ManualRefundInput {
  bookingId: string;
  amount: number; // paise; if omitted by caller, caller passes full refundable
  reason: string;
  initiatedByRole: 'ADMIN' | 'OPS';
}

/**
 * Manual partial/full refund initiated by an admin. Amount must be ≤ remaining
 * refundable. Splits across captured payments oldest-first. Returns created refunds.
 */
export async function issueManualRefund(input: ManualRefundInput) {
  const { refundable, successPayments } = await computeRefundable(input.bookingId);
  if (input.amount <= 0) throw Errors.validation('Refund amount must be positive');
  if (input.amount > refundable) throw Errors.conflict(`Refund exceeds refundable amount (${refundable} paise)`);

  const created: { id: string; amount: number; status: string }[] = [];
  let remaining = input.amount;

  for (const p of successPayments) {
    if (remaining <= 0) break;
    const slice = Math.min(remaining, p.amountPaid);
    remaining -= slice;

    const refund = await prisma.refund.create({
      data: {
        paymentId: p.id,
        amount: slice,
        reason: input.reason,
        initiatedBy: input.initiatedByRole,
        status: 'CREATED',
      },
    });

    if (isRazorpayConfigured() && p.gatewayPayId) {
      try {
        const gw = await gatewayCreateRefund({
          paymentId: p.gatewayPayId,
          amount: slice,
          notes: { bookingId: input.bookingId, refundId: refund.id, reason: input.reason },
        });
        await prisma.refund.update({
          where: { id: refund.id },
          data: { gatewayRefundId: gw.id, status: 'PENDING' },
        });
      } catch (err) {
        await prisma.refund.update({
          where: { id: refund.id },
          data: { status: 'FAILED', failureReason: err instanceof Error ? err.message : 'gateway error' },
        });
      }
    }

    const fresh = await prisma.refund.findUnique({ where: { id: refund.id } });
    created.push({ id: refund.id, amount: slice, status: fresh?.status ?? 'CREATED' });
  }

  await enqueueNotification(input.bookingId, 'refund_completed', { refundAmount: input.amount });
  return { refunds: created, amount: input.amount };
}

export interface RefundListFilters {
  status?: string;
  bookingId?: string;
  cursor?: string;
  limit: number;
}

export async function listRefunds(f: RefundListFilters) {
  const where: Prisma.RefundWhereInput = {};
  if (f.status) where.status = f.status as Prisma.RefundWhereInput['status'];
  if (f.bookingId) where.payment = { bookingId: f.bookingId };
  const rows = await prisma.refund.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { payment: { select: { bookingId: true, gatewayPayId: true } } },
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? (rows[f.limit - 1]?.id ?? null) : null };
}

/** SUPER_ADMIN reconcile: mark a stuck/pending refund as processed manually. */
export async function reconcileRefund(refundId: string, note: string) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw Errors.notFound('Refund not found');
  if (refund.status === 'PROCESSED') throw Errors.conflict('Refund already processed');
  return prisma.refund.update({
    where: { id: refundId },
    data: { status: 'PROCESSED', processedAt: new Date(), failureReason: note },
  });
}
