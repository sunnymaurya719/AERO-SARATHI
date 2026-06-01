import { Prisma } from '@aero/db';
import type { BookingStatus } from '@aero/db';
import { prisma } from '../prisma.js';

/** Allowed booking status transitions. Any move not listed is rejected. */
const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['DRIVER_ASSIGNED', 'CANCELLED'],
  DRIVER_ASSIGNED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ONGOING', 'NO_SHOW', 'CANCELLED'],
  ONGOING: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: BookingStatus,
    public readonly to: BookingStatus,
  ) {
    super(`Illegal transition ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class BookingNotFoundError extends Error {
  constructor() {
    super('booking_not_found');
    this.name = 'BookingNotFoundError';
  }
}

interface TransitionCtx {
  actorId?: string;
  reason?: string;
}

/**
 * Atomically transition a booking to `to`, locking the row FOR UPDATE so two
 * concurrent callers (e.g. client verify + webhook) cannot both apply the move.
 * Writes a BookingStatusEvent. Idempotent when already in the target state.
 */
export async function transitionBooking(
  bookingId: string,
  to: BookingStatus,
  ctx: TransitionCtx = {},
): Promise<void> {
  let transitioned = false;
  let scheduledAt: Date | null = null;
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: BookingStatus; scheduledAt: Date }[]>(
      Prisma.sql`SELECT "status", "scheduledAt" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`,
    );
    const from = rows[0]?.status;
    if (!from) throw new BookingNotFoundError();
    if (from === to) return; // idempotent — already there
    if (!ALLOWED[from].includes(to)) throw new IllegalTransitionError(from, to);

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: to,
        ...(to === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
        ...(to === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
      },
    });
    await tx.bookingStatusEvent.create({
      data: { bookingId, from, to, actorId: ctx.actorId ?? null, reason: ctx.reason ?? null },
    });
    transitioned = true;
    scheduledAt = rows[0]?.scheduledAt ?? null;
  });

  // Post-commit Phase 4/5 hooks (best-effort; never block or fail the transition).
  if (transitioned) {
    try {
      const hooks = await import('../hooks/booking.confirmed.hook.js');
      if (to === 'CONFIRMED' && scheduledAt) await hooks.onBookingConfirmed(bookingId, scheduledAt);
      if (to === 'CANCELLED') await hooks.onBookingCancelled(bookingId);
    } catch {
      // hooks log their own errors
    }
    try {
      const p5 = await import('../hooks/phase5.hooks.js');
      if (to === 'DRIVER_ASSIGNED') await p5.onDriverAssigned(bookingId);
      if (to === 'COMPLETED' || to === 'CANCELLED' || to === 'NO_SHOW') await p5.onTripTerminal(bookingId);
    } catch {
      // hooks log their own errors
    }
  }
}

export const ALLOWED_TRANSITIONS = ALLOWED;
