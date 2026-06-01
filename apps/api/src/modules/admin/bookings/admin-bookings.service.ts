import { Prisma } from '@aero/db';
import type { BookingStatus } from '@aero/db';
import { prisma } from '../../../prisma.js';
import { Errors } from '../../../errors.js';
import { logger } from '../../../logger.js';
import { transitionBooking } from '../../../state/booking.transitions.js';
import { computeCancellation } from '../../cancellations/policy.js';
import { createRefund, isRazorpayConfigured } from '../../payments/razorpay.js';
import { enqueueNotification } from '../../notifications/notifications.service.js';
import type { NotificationTemplate } from '../../notifications/templates.js';

const CANCELLABLE = new Set(['PENDING', 'CONFIRMED']);
const VALID_RESEND_TEMPLATES: NotificationTemplate[] = [
  'booking_confirmed',
  'payment_failed',
  'cancellation_confirmed',
  'refund_completed',
];

export interface BookingListFilters {
  status?: BookingStatus[];
  dateField: 'scheduled' | 'created';
  from?: Date;
  to?: Date;
  q?: string;
  driverId?: string;
  vehicleCategory?: string;
  cursor?: string;
  limit: number;
}

export async function listBookings(f: BookingListFilters) {
  const where: Prisma.BookingWhereInput = {};
  if (f.status?.length) where.status = { in: f.status };
  if (f.driverId) where.driverId = f.driverId;
  if (f.vehicleCategory) where.vehicleCategory = f.vehicleCategory as Prisma.BookingWhereInput['vehicleCategory'];

  const dateCol = f.dateField === 'scheduled' ? 'scheduledAt' : 'createdAt';
  if (f.from || f.to) {
    where[dateCol] = {
      ...(f.from ? { gte: f.from } : {}),
      ...(f.to ? { lte: f.to } : {}),
    };
  }
  if (f.q) {
    where.OR = [
      { code: { contains: f.q, mode: 'insensitive' } },
      { passengerPhone: { contains: f.q } },
      { passengerName: { contains: f.q, mode: 'insensitive' } },
    ];
  }

  const rows = await prisma.booking.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { driver: { select: { id: true, name: true } } },
  });
  const hasMore = rows.length > f.limit;
  const items = (hasMore ? rows.slice(0, f.limit) : rows).map((b) => ({
    id: b.id,
    code: b.code,
    status: b.status,
    passengerName: b.passengerName,
    passengerPhone: maskPhone(b.passengerPhone),
    pickupAddress: b.pickupAddress,
    dropAddress: b.dropAddress,
    scheduledAt: b.scheduledAt.toISOString(),
    vehicleCategory: b.vehicleCategory,
    fareTotal: b.fareTotal,
    tokenAmount: b.tokenAmount,
    driver: b.driver ? { id: b.driver.id, name: b.driver.name } : null,
    createdAt: b.createdAt.toISOString(),
  }));

  return { items, nextCursor: hasMore ? (rows[f.limit - 1]?.id ?? null) : null };
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return '****';
  return `${phone.slice(0, 3)}XXXXX${phone.slice(-4)}`;
}

export async function getAdminBookingDetail(id: string) {
  const b = await prisma.booking.findUnique({
    where: { id },
    include: {
      payments: { include: { refunds: true }, orderBy: { createdAt: 'asc' } },
      cancellation: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
      notifications: { orderBy: { createdAt: 'desc' } },
      notes: { orderBy: { createdAt: 'desc' } },
      driver: true,
      vehicle: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
    },
  });
  if (!b) throw Errors.notFound('Booking not found');
  return b;
}

export interface AssignContext {
  actorId: string;
  reason?: string;
}

/**
 * Manual driver assignment with conflict detection: driver must be ACTIVE, have
 * a vehicle of a compatible category, and have no overlapping assignment within
 * ±2h of this booking's scheduledAt.
 */
export async function assignDriver(bookingId: string, driverId: string, ctx: AssignContext) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw Errors.notFound('Booking not found');
  if (booking.status !== 'CONFIRMED') {
    throw Errors.conflict('Driver can only be assigned to a CONFIRMED booking');
  }

  const driver = await prisma.driver.findUnique({ where: { id: driverId }, include: { vehicle: true } });
  if (!driver) throw Errors.notFound('Driver not found');
  if (driver.status !== 'ACTIVE') throw Errors.conflict('Driver is not ACTIVE');
  if (!driver.vehicle) throw Errors.conflict('Driver has no vehicle assigned');
  if (driver.vehicle.category !== booking.vehicleCategory) {
    throw Errors.conflict(`Vehicle category ${driver.vehicle.category} does not match booking ${booking.vehicleCategory}`);
  }

  const windowStart = new Date(booking.scheduledAt.getTime() - 2 * 60 * 60 * 1000);
  const windowEnd = new Date(booking.scheduledAt.getTime() + 2 * 60 * 60 * 1000);
  const overlap = await prisma.booking.findFirst({
    where: {
      driverId,
      id: { not: bookingId },
      status: { in: ['DRIVER_ASSIGNED', 'EN_ROUTE', 'ONGOING'] },
      scheduledAt: { gte: windowStart, lte: windowEnd },
    },
    select: { id: true, code: true },
  });
  if (overlap) throw Errors.conflict(`Driver has an overlapping trip (${overlap.code})`);

  const before = { driverId: booking.driverId, status: booking.status };
  await prisma.booking.update({
    where: { id: bookingId },
    data: { driverId, vehicleId: driver.vehicle.id },
  });
  await transitionBooking(bookingId, 'DRIVER_ASSIGNED', { actorId: ctx.actorId, reason: ctx.reason });

  // Reuse Phase 2 notification pipeline (placeholder template until Phase 4).
  void enqueueNotification(bookingId, 'booking_confirmed');

  return { before, after: { driverId, status: 'DRIVER_ASSIGNED' as const, vehicleId: driver.vehicle.id } };
}

export async function unassignDriver(bookingId: string, ctx: AssignContext) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw Errors.notFound('Booking not found');
  if (booking.status !== 'DRIVER_ASSIGNED') {
    throw Errors.conflict('Only a DRIVER_ASSIGNED booking can be unassigned');
  }
  const before = { driverId: booking.driverId, status: booking.status };
  // CONFIRMED is not a forward transition from DRIVER_ASSIGNED in the normal
  // state machine, so apply the rollback directly within a locked update.
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { driverId: null, vehicleId: null, status: 'CONFIRMED' },
    });
    await tx.bookingStatusEvent.create({
      data: { bookingId, from: 'DRIVER_ASSIGNED', to: 'CONFIRMED', actorId: ctx.actorId, reason: ctx.reason },
    });
  });
  return { before, after: { driverId: null, status: 'CONFIRMED' as const } };
}

export interface AdminTransitionContext {
  actorId: string;
  reason: string;
}

export async function adminTransition(bookingId: string, to: BookingStatus, ctx: AdminTransitionContext) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { status: true } });
  if (!booking) throw Errors.notFound('Booking not found');
  const before = { status: booking.status };
  await transitionBooking(bookingId, to, { actorId: ctx.actorId, reason: ctx.reason });
  return { before, after: { status: to } };
}

export interface AdminCancelContext {
  actorId: string;
  reason: string;
  refundOverride?: number;
  canOverride: boolean;
}

/**
 * Admin-initiated cancellation. Computes the policy refund; an ADMIN/SUPER_ADMIN
 * may override it (capped at tokenPaid). Returns both computed and final values
 * for audit logging.
 */
export async function adminCancel(bookingId: string, ctx: AdminCancelContext) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { payments: true, cancellation: true },
  });
  if (!booking) throw Errors.notFound('Booking not found');
  if (booking.cancellation) throw Errors.conflict('Booking already cancelled');
  if (!CANCELLABLE.has(booking.status)) throw Errors.conflict(`Booking in ${booking.status} cannot be cancelled`);

  const tokenPaid = booking.payments
    .filter((p) => p.type === 'TOKEN' && p.status === 'SUCCESS')
    .reduce((sum, p) => sum + p.amountPaid, 0);

  const computed = computeCancellation(tokenPaid, booking.createdAt, booking.scheduledAt);

  let refundAmount = computed.refundAmount;
  let feeAmount = computed.feeAmount;
  if (ctx.refundOverride !== undefined) {
    if (!ctx.canOverride) throw Errors.forbidden('Refund override requires ADMIN or SUPER_ADMIN');
    if (ctx.refundOverride < 0 || ctx.refundOverride > tokenPaid) {
      throw Errors.validation('Override must be between 0 and the token paid');
    }
    refundAmount = ctx.refundOverride;
    feeAmount = tokenPaid - refundAmount;
  }

  await prisma.cancellation.create({
    data: {
      bookingId: booking.id,
      cancelledBy: 'ADMIN',
      reason: ctx.reason,
      policyBucket: computed.bucket,
      feeAmount,
      refundAmount,
    },
  });
  await transitionBooking(booking.id, 'CANCELLED', { actorId: ctx.actorId, reason: ctx.reason });

  let refundStatus: string | null = null;
  const tokenPayment = booking.payments.find((p) => p.type === 'TOKEN' && p.status === 'SUCCESS' && p.gatewayPayId);
  if (refundAmount > 0 && tokenPayment?.gatewayPayId) {
    if (!isRazorpayConfigured()) {
      logger.warn({ bookingId }, 'admin_refund_skipped_razorpay_unconfigured');
    } else {
      try {
        const rzp = await createRefund({
          paymentId: tokenPayment.gatewayPayId,
          amount: refundAmount,
          notes: { bookingId: booking.id, bookingCode: booking.code, by: 'admin' },
        });
        const refund = await prisma.refund.create({
          data: {
            paymentId: tokenPayment.id,
            amount: refundAmount,
            status: 'PENDING',
            gatewayRefundId: rzp.id,
            reason: ctx.reason,
            initiatedBy: 'ADMIN',
          },
        });
        await prisma.cancellation.update({ where: { bookingId: booking.id }, data: { refundId: refund.id } });
        refundStatus = 'PENDING';
      } catch (err) {
        logger.error({ err, bookingId }, 'admin_refund_initiation_failed');
      }
    }
  }

  void enqueueNotification(booking.id, 'cancellation_confirmed', { refundAmount });

  return {
    computed: { feeAmount: computed.feeAmount, refundAmount: computed.refundAmount, bucket: computed.bucket },
    final: { feeAmount, refundAmount, refundStatus },
    before: { status: booking.status },
    after: { status: 'CANCELLED' as const },
  };
}

export async function addBookingNote(bookingId: string, authorId: string, body: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
  if (!booking) throw Errors.notFound('Booking not found');
  return prisma.bookingNote.create({ data: { bookingId, authorId, body } });
}

export async function resendNotification(bookingId: string, template: string) {
  if (!VALID_RESEND_TEMPLATES.includes(template as NotificationTemplate)) {
    throw Errors.validation('Unknown notification template');
  }
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } });
  if (!booking) throw Errors.notFound('Booking not found');
  await enqueueNotification(bookingId, template as NotificationTemplate);
}

/** Streamable CSV rows for the bookings export. */
export async function* exportBookingsCsv(f: BookingListFilters): AsyncGenerator<string> {
  const header = [
    'code', 'status', 'scheduledAt', 'fareTotal', 'tokenAmount', 'balanceAmount',
    'paymentStatus', 'refundAmount', 'driver', 'vehicleCategory',
  ].join(',');
  yield `${header}\n`;

  const where: Prisma.BookingWhereInput = {};
  if (f.status?.length) where.status = { in: f.status };
  if (f.driverId) where.driverId = f.driverId;
  const dateCol = f.dateField === 'scheduled' ? 'scheduledAt' : 'createdAt';
  if (f.from || f.to) where[dateCol] = { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) };

  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        payments: { select: { status: true, type: true } },
        cancellation: { select: { refundAmount: true } },
        driver: { select: { name: true } },
      },
    });
    if (rows.length === 0) break;
    for (const b of rows) {
      const tokenPayment = b.payments.find((p) => p.type === 'TOKEN');
      const cells = [
        b.code,
        b.status,
        b.scheduledAt.toISOString(),
        b.fareTotal,
        b.tokenAmount,
        b.balanceAmount,
        tokenPayment?.status ?? 'NONE',
        b.cancellation?.refundAmount ?? 0,
        csvCell(b.driver?.name ?? ''),
        b.vehicleCategory,
      ];
      yield `${cells.join(',')}\n`;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < 500) break;
  }
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
