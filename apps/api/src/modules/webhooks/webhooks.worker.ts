import { Worker } from 'bullmq';
import type { Worker as BullWorker } from 'bullmq';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { bullConnection, QUEUE_WEBHOOK, type WebhookJobData } from '../../queues/index.js';
import { transitionBooking } from '../../state/booking.transitions.js';
import { enqueueNotification } from '../notifications/notifications.service.js';

interface RzpEntity {
  id: string;
  order_id?: string;
  method?: string;
  amount?: number;
  fee?: number;
  tax?: number;
  error_code?: string;
  error_description?: string;
  created_at?: number;
  notes?: Record<string, string>;
}

interface RzpWebhook {
  event: string;
  payload?: {
    payment?: { entity?: RzpEntity };
    refund?: { entity?: RzpEntity };
  };
}

/**
 * Processes the `webhooks` queue. Every event maps booking/payment/refund state
 * deterministically and idempotently. Throws on transient errors so BullMQ
 * retries; persists the error onto the WebhookEvent for forensics.
 */
export function startWebhookWorker(): BullWorker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    QUEUE_WEBHOOK,
    async (job) => {
      const we = await prisma.webhookEvent.findUniqueOrThrow({ where: { id: job.data.webhookEventId } });
      if (we.processedAt) return; // already done

      try {
        await route(we.eventType, we.payload as unknown as RzpWebhook);
        await prisma.webhookEvent.update({
          where: { id: we.id },
          data: { processedAt: new Date(), processingError: null },
        });
      } catch (err) {
        await prisma.webhookEvent.update({
          where: { id: we.id },
          data: { processingError: err instanceof Error ? err.message : String(err) },
        });
        throw err;
      }
    },
    { connection: bullConnection, concurrency: 4 },
  );

  worker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, err: err.message }, 'webhook_job_failed');
  });
  return worker;
}

async function route(eventType: string, body: RzpWebhook): Promise<void> {
  switch (eventType) {
    case 'payment.captured':
      return onPaymentCaptured(body.payload?.payment?.entity);
    case 'payment.failed':
      return onPaymentFailed(body.payload?.payment?.entity);
    case 'payment.authorized':
      return; // auto-capture enabled; nothing to do
    case 'refund.created':
    case 'refund.processed':
    case 'refund.failed':
      return onRefund(eventType, body.payload?.refund?.entity);
    default:
      return; // ignore but mark processed
  }
}

async function onPaymentCaptured(ent?: RzpEntity): Promise<void> {
  if (!ent?.order_id) throw new Error('payment_captured_no_order');
  const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: ent.order_id } });
  if (!payment) throw new Error('payment_not_found_for_order');
  if (payment.status === 'SUCCESS') return; // already captured

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'SUCCESS',
      gatewayPayId: ent.id,
      gatewayMethod: ent.method ?? null,
      gatewayFee: ent.fee ?? null,
      gatewayTax: ent.tax ?? null,
      amountPaid: ent.amount ?? payment.amount,
      capturedAt: ent.created_at ? new Date(ent.created_at * 1000) : new Date(),
    },
  });

  if (payment.type === 'TOKEN') {
    await transitionBooking(payment.bookingId, 'CONFIRMED', { reason: 'razorpay_webhook' });
    void enqueueNotification(payment.bookingId, 'booking_confirmed');
  }
}

async function onPaymentFailed(ent?: RzpEntity): Promise<void> {
  if (!ent?.order_id) return;
  const payment = await prisma.payment.findUnique({ where: { gatewayOrderId: ent.order_id } });
  if (!payment || payment.status === 'SUCCESS') return;

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: 'FAILED',
      gatewayPayId: ent.id,
      failureCode: ent.error_code ?? null,
      failureReason: ent.error_description ?? null,
    },
  });
  void enqueueNotification(payment.bookingId, 'payment_failed');
}

async function onRefund(eventType: string, ent?: RzpEntity): Promise<void> {
  if (!ent?.id) return;
  const refund = await prisma.refund.findUnique({ where: { gatewayRefundId: ent.id } });
  if (!refund) return; // only track refunds we initiated

  const status = eventType === 'refund.processed' ? 'PROCESSED' : eventType === 'refund.failed' ? 'FAILED' : 'PENDING';

  await prisma.refund.update({
    where: { id: refund.id },
    data: {
      status,
      processedAt: status === 'PROCESSED' ? new Date() : null,
      failureReason: ent.notes?.failure_reason ?? null,
    },
  });

  if (status === 'PROCESSED') {
    const payment = await prisma.payment.update({
      where: { id: refund.paymentId },
      data: { status: 'REFUNDED' },
    });
    void enqueueNotification(payment.bookingId, 'refund_completed', { refundAmount: refund.amount });
  } else if (status === 'FAILED') {
    logger.error({ refundId: refund.id }, 'refund_failed_admin_alert');
  }
}
