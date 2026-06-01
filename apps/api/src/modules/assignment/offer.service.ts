import { Prisma } from '@aero/db';
import type { Offer } from '@aero/db';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { Errors } from '../../errors.js';
import { offerExpiryQueue, assignmentQueue } from '../../queues/phase4.queues.js';
import { dispatchBookingNotification } from '../notifications/notifications.service.js';
import { emitToDriver } from '../../realtime/io.js';
import { sendOfferPush } from '../../integrations/fcm.js';
import { systemAudit } from '../../middleware/audit.js';
import { markRecentDecline } from './driver-presence.js';
import type { RankedCandidate } from '@aero/types';

const offerLockKey = (driverId: string): string => `offer-lock:${driverId}`;
const expiryJobId = (offerId: string): string => `expiry:${offerId}`;

function maskPhone(phone: string): string {
  return phone.length >= 4 ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : '****';
}

/** Offer TTL tightens as the pickup approaches (§6.5). */
export function computeOfferTtlSec(scheduledAt: Date, now: Date = new Date()): number {
  const minsToPickup = (scheduledAt.getTime() - now.getTime()) / 60000;
  if (minsToPickup < 45) return env.OFFER_TTL_VERY_SHORT_SEC;
  if (minsToPickup < 60) return env.OFFER_TTL_SHORT_SEC;
  return env.OFFER_TTL_SEC;
}

/**
 * Create an offer for a single driver. Acquires a per-driver Redis lock to
 * enforce one open offer at a time. Returns the created Offer, or null if the
 * lock could not be acquired (caller should try the next candidate).
 */
export async function createOffer(params: {
  bookingId: string;
  driverId: string;
  attemptNumber: number;
  ranked: RankedCandidate;
  scheduledAt: Date;
}): Promise<Offer | null> {
  const now = new Date();
  const ttlSec = computeOfferTtlSec(params.scheduledAt, now);

  const lock = await redis.set(offerLockKey(params.driverId), params.bookingId, 'EX', ttlSec + 5, 'NX');
  if (lock !== 'OK') {
    logger.info({ driverId: params.driverId }, 'offer_lock_busy');
    return null;
  }

  let offer: Offer;
  try {
    offer = await prisma.offer.create({
      data: {
        bookingId: params.bookingId,
        driverId: params.driverId,
        attemptNumber: params.attemptNumber,
        score: params.ranked.score,
        scoreBreakdown: params.ranked.breakdown as unknown as Prisma.InputJsonValue,
        status: 'OFFERED',
        expiresAt: new Date(now.getTime() + ttlSec * 1000),
      },
    });
  } catch (err) {
    await redis.del(offerLockKey(params.driverId));
    throw err;
  }

  // Schedule expiry.
  await offerExpiryQueue.add(
    'expire',
    { offerId: offer.id },
    { delay: ttlSec * 1000, jobId: expiryJobId(offer.id) },
  );

  // Notify driver across channels (SMS guaranteed; FCM + socket best-effort).
  const driver = await prisma.driver.findUnique({ where: { id: params.driverId } });
  const deepLink = `${env.DRIVER_PUBLIC_URL.replace(/\/$/, '')}/offers/${offer.id}`;
  const notifIds = await dispatchBookingNotification({
    bookingId: params.bookingId,
    template: 'driver_offer',
    smsTo: driver?.phone,
    emailTo: null,
    userId: driver?.userId ?? undefined,
    extra: { deepLink },
  });
  await prisma.offer.update({ where: { id: offer.id }, data: { notificationIds: notifIds } });

  void sendOfferPush(params.driverId, {
    type: 'offer',
    offerId: offer.id,
    deepLink: `/offers/${offer.id}`,
    expiresAt: offer.expiresAt.toISOString(),
  });
  emitToDriver(params.driverId, 'offer:new', {
    offerId: offer.id,
    bookingId: params.bookingId,
    expiresAt: offer.expiresAt.toISOString(),
  });

  await systemAudit({
    action: 'offer.created',
    entity: { type: 'Offer', id: offer.id },
    reason: `attempt ${params.attemptNumber}`,
  });

  return offer;
}

async function releaseLock(driverId: string): Promise<void> {
  await redis.del(offerLockKey(driverId));
}

async function removeExpiryJob(offerId: string): Promise<void> {
  const job = await offerExpiryQueue.getJob(expiryJobId(offerId));
  if (job) await job.remove().catch(() => undefined);
}

/** Recompute and persist a driver's offer stats from raw counters. */
async function bumpStats(
  driverId: string,
  kind: 'accepted' | 'declined' | 'expired',
  responseSec?: number,
): Promise<void> {
  const existing = await prisma.driverOfferStats.findUnique({ where: { driverId } });
  const total = (existing?.offersTotal ?? 0) + 1;
  const accepted = (existing?.offersAccepted ?? 0) + (kind === 'accepted' ? 1 : 0);
  const declined = (existing?.offersDeclined ?? 0) + (kind === 'declined' ? 1 : 0);
  const expired = (existing?.offersExpired ?? 0) + (kind === 'expired' ? 1 : 0);
  const acceptanceRate = total > 0 ? accepted / total : 0;
  const prevAvg = existing?.avgResponseSec ?? 0;
  const avgResponseSec =
    responseSec != null && total > 0 ? (prevAvg * (total - 1) + responseSec) / total : prevAvg;

  await prisma.driverOfferStats.upsert({
    where: { driverId },
    create: {
      driverId,
      offersTotal: total,
      offersAccepted: accepted,
      offersDeclined: declined,
      offersExpired: expired,
      acceptanceRate,
      avgResponseSec,
    },
    update: {
      offersTotal: total,
      offersAccepted: accepted,
      offersDeclined: declined,
      offersExpired: expired,
      acceptanceRate,
      avgResponseSec,
    },
  });
}

function enqueueRetry(bookingId: string, attemptNumber: number, reason: string, delayMs = 0): Promise<unknown> {
  return assignmentQueue.add(
    'assign',
    { bookingId, attemptNumber, triggerReason: reason },
    { delay: delayMs, jobId: `assign:${bookingId}:${attemptNumber}`, attempts: 1, removeOnComplete: 1000 },
  );
}

/**
 * Driver accepts an offer. Atomically assigns the booking under row locks and
 * transitions CONFIRMED → DRIVER_ASSIGNED. Returns the assigned booking id.
 */
export async function acceptOffer(offerId: string, driverUserId: string): Promise<{ bookingId: string }> {
  const driver = await prisma.driver.findUnique({ where: { userId: driverUserId } });
  if (!driver) throw Errors.forbidden('not_a_driver');

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; bookingId: string; driverId: string; status: string; expiresAt: Date; offeredAt: Date }[]
    >(
      Prisma.sql`SELECT "id","bookingId","driverId","status","expiresAt","offeredAt" FROM "Offer" WHERE "id" = ${offerId} FOR UPDATE`,
    );
    const offer = rows[0];
    if (!offer) throw Errors.notFound('offer_not_found');
    if (offer.driverId !== driver.id) throw Errors.forbidden('not_your_offer');
    if (offer.status !== 'OFFERED') throw Errors.conflict(`offer_${offer.status.toLowerCase()}`);
    if (offer.expiresAt <= new Date()) throw Errors.conflict('offer_expired');

    const bRows = await tx.$queryRaw<{ status: string }[]>(
      Prisma.sql`SELECT "status" FROM "Booking" WHERE "id" = ${offer.bookingId} FOR UPDATE`,
    );
    const bStatus = bRows[0]?.status;
    if (!bStatus) throw Errors.notFound('booking_not_found');
    if (bStatus !== 'CONFIRMED') {
      await tx.offer.update({
        where: { id: offerId },
        data: { status: 'CANCELLED', respondedAt: new Date(), responseReason: 'booking_state_changed' },
      });
      throw Errors.conflict('booking_state_changed');
    }

    const respondedAt = new Date();
    await tx.offer.update({
      where: { id: offerId },
      data: { status: 'ACCEPTED', respondedAt },
    });
    await tx.booking.update({
      where: { id: offer.bookingId },
      data: { driverId: driver.id, vehicleId: driver.vehicleId, assignedAt: respondedAt, status: 'DRIVER_ASSIGNED' },
    });
    await tx.bookingStatusEvent.create({
      data: { bookingId: offer.bookingId, from: 'CONFIRMED', to: 'DRIVER_ASSIGNED', actorId: driver.id, reason: 'offer_accepted' },
    });
    // Defensive: cancel any sibling open offers for this booking.
    await tx.offer.updateMany({
      where: { bookingId: offer.bookingId, status: 'OFFERED', id: { not: offerId } },
      data: { status: 'CANCELLED', respondedAt, responseReason: 'sibling_accepted' },
    });

    const responseSec = Math.max(0, Math.floor((respondedAt.getTime() - offer.offeredAt.getTime()) / 1000));
    return { bookingId: offer.bookingId, responseSec };
  });

  await releaseLock(driver.id);
  await removeExpiryJob(offerId);
  await bumpStats(driver.id, 'accepted', result.responseSec);

  // Notify passenger + driver.
  const vehicle = driver.vehicleId ? await prisma.vehicle.findUnique({ where: { id: driver.vehicleId } }) : null;
  const booking = await prisma.booking.findUnique({ where: { id: result.bookingId } });
  // Phase 5: mint the shareable HMAC track link so the passenger can follow live.
  let trackUrl: string | undefined;
  try {
    const { ensureTrackLink } = await import('../trips/trips.service.js');
    trackUrl = (await ensureTrackLink(result.bookingId)) ?? undefined;
  } catch {
    // best-effort; assignment proceeds without a link
  }
  await dispatchBookingNotification({
    bookingId: result.bookingId,
    template: 'passenger_driver_assigned',
    extra: {
      driverName: driver.name,
      driverPhoneMasked: maskPhone(driver.phone),
      carModel: vehicle?.model,
      plate: vehicle?.regNo,
      trackUrl,
    },
  });
  await dispatchBookingNotification({
    bookingId: result.bookingId,
    template: 'driver_assignment_confirmed',
    smsTo: driver.phone,
    emailTo: null,
    userId: driver.userId ?? undefined,
    extra: { passengerPhone: booking?.passengerPhone },
  });

  await systemAudit({
    action: 'driver.assigned',
    entity: { type: 'Booking', id: result.bookingId },
    actor: { id: driver.id, role: 'DRIVER' },
    reason: 'offer_accepted',
  });

  return { bookingId: result.bookingId };
}

/** Driver declines an offer. Triggers an immediate next-best retry. */
export async function declineOffer(offerId: string, driverUserId: string, reason: string): Promise<void> {
  const driver = await prisma.driver.findUnique({ where: { userId: driverUserId } });
  if (!driver) throw Errors.forbidden('not_a_driver');

  const offer = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; bookingId: string; driverId: string; status: string; attemptNumber: number }[]
    >(Prisma.sql`SELECT "id","bookingId","driverId","status","attemptNumber" FROM "Offer" WHERE "id" = ${offerId} FOR UPDATE`);
    const o = rows[0];
    if (!o) throw Errors.notFound('offer_not_found');
    if (o.driverId !== driver.id) throw Errors.forbidden('not_your_offer');
    if (o.status !== 'OFFERED') throw Errors.conflict(`offer_${o.status.toLowerCase()}`);
    await tx.offer.update({
      where: { id: offerId },
      data: { status: 'DECLINED', respondedAt: new Date(), responseReason: reason },
    });
    return o;
  });

  await releaseLock(driver.id);
  await removeExpiryJob(offerId);
  await bumpStats(driver.id, 'declined');
  await markRecentDecline(driver.id);
  await enqueueRetry(offer.bookingId, offer.attemptNumber + 1, 'driver_declined');

  await systemAudit({
    action: 'offer.declined',
    entity: { type: 'Offer', id: offerId },
    actor: { id: driver.id, role: 'DRIVER' },
    reason,
  });
}

/** Offer-expiry worker entry: idempotently flips OFFERED → EXPIRED. */
export async function expireOffer(offerId: string): Promise<void> {
  const offer = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { id: string; bookingId: string; driverId: string; status: string; attemptNumber: number }[]
    >(Prisma.sql`SELECT "id","bookingId","driverId","status","attemptNumber" FROM "Offer" WHERE "id" = ${offerId} FOR UPDATE`);
    const o = rows[0];
    if (!o || o.status !== 'OFFERED') return null; // already responded — no-op
    await tx.offer.update({ where: { id: offerId }, data: { status: 'EXPIRED', respondedAt: new Date() } });
    return o;
  });
  if (!offer) return;

  await releaseLock(offer.driverId);
  await bumpStats(offer.driverId, 'expired');
  await enqueueRetry(offer.bookingId, offer.attemptNumber + 1, 'offer_expired');

  await systemAudit({
    action: 'offer.expired',
    entity: { type: 'Offer', id: offerId },
    reason: 'ttl_reached',
  });
}

/** Cancel all open offers for a booking (e.g. booking cancelled). */
export async function cancelOffersForBooking(bookingId: string, reason: string): Promise<void> {
  const open = await prisma.offer.findMany({ where: { bookingId, status: 'OFFERED' } });
  for (const o of open) {
    await prisma.offer.update({
      where: { id: o.id },
      data: { status: 'CANCELLED', respondedAt: new Date(), responseReason: reason },
    });
    await releaseLock(o.driverId);
    await removeExpiryJob(o.id);
    emitToDriver(o.driverId, 'offer:cancelled', { offerId: o.id, bookingId });
    const driver = await prisma.driver.findUnique({ where: { id: o.driverId } });
    if (driver) {
      await dispatchBookingNotification({
        bookingId,
        template: 'driver_trip_cancelled',
        smsTo: driver.phone,
        emailTo: null,
        userId: driver.userId ?? undefined,
      });
    }
  }
}
