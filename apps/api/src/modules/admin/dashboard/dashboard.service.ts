import { prisma } from '../../../prisma.js';
import { getMongo } from '../../../mongo.js';
import { webhookQueue, notificationsQueue } from '../../../queues/index.js';

function istDayBounds(now = new Date()): { start: Date; end: Date } {
  // IST is UTC+5:30. Compute the IST calendar day, then convert back to UTC.
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const ist = new Date(now.getTime() + IST_OFFSET);
  const istMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const start = new Date(istMidnight - IST_OFFSET);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export interface DashboardResponse {
  today: {
    bookingsCount: number;
    revenue: number;
    cancellations: number;
    refundsAmount: number;
    pendingAssignment: number;
  };
  alerts: unknown[];
  queueDepth: { notifications: number; webhooks: number };
}

export async function getDashboard(): Promise<DashboardResponse> {
  const { start, end } = istDayBounds();

  const [bookingsCount, revenueAgg, cancellations, refundsAgg, pendingAssignment, notifWaiting, hookWaiting] =
    await Promise.all([
      prisma.booking.count({ where: { createdAt: { gte: start, lt: end } } }),
      prisma.payment.aggregate({
        _sum: { amountPaid: true },
        where: { status: 'SUCCESS', capturedAt: { gte: start, lt: end } },
      }),
      prisma.cancellation.count({ where: { createdAt: { gte: start, lt: end } } }),
      prisma.refund.aggregate({
        _sum: { amount: true },
        where: { status: { in: ['PROCESSED', 'PENDING'] }, createdAt: { gte: start, lt: end } },
      }),
      prisma.booking.count({ where: { status: 'CONFIRMED', driverId: null } }),
      notificationsQueue.getWaitingCount(),
      webhookQueue.getWaitingCount(),
    ]);

  const alerts = await buildAlerts();

  return {
    today: {
      bookingsCount,
      revenue: revenueAgg._sum.amountPaid ?? 0,
      cancellations,
      refundsAmount: refundsAgg._sum.amount ?? 0,
      pendingAssignment,
    },
    alerts,
    queueDepth: { notifications: notifWaiting, webhooks: hookWaiting },
  };
}

async function buildAlerts(): Promise<unknown[]> {
  const alerts: unknown[] = [];
  const now = new Date();

  // Unassigned bookings within T-30min of pickup.
  const soon = new Date(now.getTime() + 30 * 60 * 1000);
  const unassigned = await prisma.booking.findMany({
    where: { status: 'CONFIRMED', driverId: null, scheduledAt: { gte: now, lte: soon } },
    select: { id: true, code: true, scheduledAt: true },
    take: 20,
  });
  for (const b of unassigned) {
    alerts.push({ type: 'unassigned_t_minus_30', bookingId: b.id, code: b.code, scheduledAt: b.scheduledAt.toISOString() });
  }

  // Refunds stuck in PENDING > 48h.
  const stuckBefore = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const stuck = await prisma.refund.findMany({
    where: { status: 'PENDING', createdAt: { lt: stuckBefore } },
    select: { id: true, createdAt: true },
    take: 20,
  });
  for (const r of stuck) {
    const ageHours = Math.round((now.getTime() - r.createdAt.getTime()) / 3_600_000);
    alerts.push({ type: 'refund_stuck', refundId: r.id, ageHours });
  }

  // Webhook dead-letter (failed, unprocessed with an error).
  const dlq = await prisma.webhookEvent.count({ where: { processedAt: null, processingError: { not: null } } });
  if (dlq > 0) alerts.push({ type: 'webhook_dlq', count: dlq });

  // Driver documents expiring within 7 days.
  const expSoon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const expiring = await prisma.driverDocument.findMany({
    where: { deletedAt: null, expiresAt: { gte: now, lte: expSoon } },
    select: { driverId: true, type: true, expiresAt: true },
    take: 20,
  });
  for (const d of expiring) {
    alerts.push({ type: 'doc_expiry', driverId: d.driverId, docType: d.type, expiresAt: d.expiresAt?.toISOString() });
  }

  // Merge any externally-produced system_alerts (Phase 4 jobs write here).
  const mongo = getMongo();
  if (mongo) {
    const external = await mongo
      .collection('system_alerts')
      .find({ resolvedAt: null })
      .sort({ ts: -1 })
      .limit(20)
      .toArray();
    for (const a of external) alerts.push(a);
  }

  return alerts;
}
