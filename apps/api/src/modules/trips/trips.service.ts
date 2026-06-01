import { Prisma } from '@aero/db';
import type { Booking } from '@aero/db';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { Errors } from '../../errors.js';
import { transitionBooking } from '../../state/booking.transitions.js';
import { dispatchBookingNotification } from '../notifications/notifications.service.js';
import { systemAudit } from '../../middleware/audit.js';
import { fanoutStatus } from '../../realtime/io.js';
import { haversineM, type LatLng } from '../tracking/geo.js';
import {
  setActiveTrip,
  clearActiveTrip,
  getHotLocation,
} from '../tracking/location-store.js';
import { issueTrackToken } from '../tracking/track-token.js';
import {
  scheduleEtaTick,
  removeEtaTick,
  tripStaleQueue,
  tripFraudQueue,
  staleJobName,
} from '../../queues/phase5.queues.js';
import { currentEtaCadenceSec } from '../tracking/eta.service.js';
import type { DriverTripDetail, TrackStage } from '@aero/types';

/**
 * Driver trip lifecycle (Phase 5 §8): Start → Arrived → Begin → Complete, plus
 * No-show. Each mutation guards preconditions, transitions booking state, and
 * keeps the Redis hot store + ETA tick + watchdog jobs in sync.
 */

function maskPhone(phone: string): string {
  return phone.length >= 6 ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : '****';
}

function stageOf(b: { status: string; arrivedAt: Date | null }): TrackStage {
  switch (b.status) {
    case 'DRIVER_ASSIGNED':
      return 'assigned';
    case 'EN_ROUTE':
      return b.arrivedAt ? 'arrived' : 'en_route';
    case 'ONGOING':
      return 'ongoing';
    case 'COMPLETED':
      return 'completed';
    default:
      return 'assigned';
  }
}

async function loadOwnedTrip(driverId: string, bookingId: string): Promise<Booking> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.driverId !== driverId) throw Errors.notFound('trip_not_found');
  return booking;
}

function toDetail(b: Booking, trip: { totalKm: number | null; totalMin: number | null; pingCount: number } | null, trackUrl: string | null): DriverTripDetail {
  return {
    id: b.id,
    code: b.code,
    status: b.status,
    stage: stageOf(b),
    scheduledAt: b.scheduledAt.toISOString(),
    enRouteAt: b.enRouteAt?.toISOString() ?? null,
    arrivedAt: b.arrivedAt?.toISOString() ?? null,
    startedAt: b.startedAt?.toISOString() ?? null,
    completedAt: b.completedAt?.toISOString() ?? null,
    pickup: { address: b.pickupAddress, lat: b.pickupLat, lng: b.pickupLng },
    drop: { address: b.dropAddress, lat: b.dropLat, lng: b.dropLng },
    passengerName: b.passengerName,
    passengerPhoneMasked: maskPhone(b.passengerPhone),
    trackUrl,
    trip,
  };
}

/** Read the full run-screen snapshot for a driver's trip. */
export async function getTripRunDetail(driverId: string, bookingId: string): Promise<DriverTripDetail> {
  const b = await loadOwnedTrip(driverId, bookingId);
  const trip = await prisma.trip.findUnique({ where: { bookingId } });
  return toDetail(b, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
}

// ── Start trip → EN_ROUTE ────────────────────────────────────────────────────

export async function startTrip(driverId: string, bookingId: string): Promise<DriverTripDetail> {
  if (!env.TRACKING_ENABLED) throw Errors.conflict('tracking_disabled');
  const b = await loadOwnedTrip(driverId, bookingId);

  // Idempotent: already started.
  if (b.status === 'EN_ROUTE') {
    const trip = await prisma.trip.findUnique({ where: { bookingId } });
    return toDetail(b, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
  }
  if (b.status !== 'DRIVER_ASSIGNED') throw Errors.conflict(`cannot_start_from_${b.status.toLowerCase()}`);

  const now = new Date();
  const earliest = new Date(b.scheduledAt.getTime() - env.TRIP_START_EARLY_MIN * 60_000);
  const latest = new Date(b.scheduledAt.getTime() + env.TRIP_START_LATE_MIN * 60_000);
  if (now < earliest) throw Errors.conflict('too_early_to_start');
  if (now > latest) throw Errors.conflict('start_window_passed');

  const startLoc = await getHotLocation(driverId);
  const vehicleId = b.vehicleId ?? '';

  await transitionBooking(bookingId, 'EN_ROUTE', { actorId: driverId, reason: 'driver_start' });
  await prisma.booking.update({ where: { id: bookingId }, data: { enRouteAt: now } });
  await prisma.trip.upsert({
    where: { bookingId },
    create: {
      bookingId,
      driverId,
      vehicleId,
      startLat: startLoc?.lat ?? null,
      startLng: startLoc?.lng ?? null,
    },
    update: { startLat: startLoc?.lat ?? null, startLng: startLoc?.lng ?? null },
  });

  await setActiveTrip({ bookingId, driverId, code: b.code, status: 'EN_ROUTE', startedAt: now.toISOString() });
  await scheduleEtaTick(bookingId, await currentEtaCadenceSec());

  // Stale watchdog fires 15 min after scheduledAt.
  const staleDelay = Math.max(60_000, b.scheduledAt.getTime() + 15 * 60_000 - now.getTime());
  await tripStaleQueue.add(staleJobName(bookingId), { bookingId }, { delay: staleDelay, jobId: staleJobName(bookingId) });

  await dispatchBookingNotification({ bookingId, template: 'passenger_driver_en_route' });
  await fanoutStatus(bookingId, 'en_route', 'EN_ROUTE');
  await systemAudit({
    action: 'trip.start',
    entity: { type: 'Booking', id: bookingId, code: b.code },
    actor: { id: driverId, role: 'DRIVER' },
  });

  const updated = await loadOwnedTrip(driverId, bookingId);
  const trip = await prisma.trip.findUnique({ where: { bookingId } });
  return toDetail(updated, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
}

// ── Arrived at pickup (no status change) ─────────────────────────────────────

export async function arrivedAtPickup(
  driverId: string,
  bookingId: string,
  force = false,
): Promise<DriverTripDetail> {
  const b = await loadOwnedTrip(driverId, bookingId);
  if (b.status !== 'EN_ROUTE') throw Errors.conflict(`cannot_arrive_from_${b.status.toLowerCase()}`);
  if (b.arrivedAt) {
    const trip = await prisma.trip.findUnique({ where: { bookingId } });
    return toDetail(b, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
  }

  const loc = await getHotLocation(driverId);
  const pickup: LatLng = { lat: b.pickupLat, lng: b.pickupLng };
  let farFlag = false;
  if (loc) {
    const distM = haversineM(loc, pickup);
    if (distM > 500 && !force) {
      throw Errors.validation('too_far_from_pickup', [{ distanceM: Math.round(distM), confirmPath: '?force=true' }]);
    }
    if (distM > 500 && force) farFlag = true;
  }

  const now = new Date();
  await prisma.booking.update({ where: { id: bookingId }, data: { arrivedAt: now } });
  await prisma.trip.update({
    where: { bookingId },
    data: {
      pickupReachedLat: loc?.lat ?? null,
      pickupReachedLng: loc?.lng ?? null,
      ...(farFlag
        ? {
            fraudFlags: [{ type: 'arrived_far_from_pickup', detail: 'driver confirmed anyway', weight: 0.2 }] as unknown as Prisma.InputJsonValue,
          }
        : {}),
    },
  });

  await dispatchBookingNotification({ bookingId, template: 'passenger_driver_arrived' });
  await fanoutStatus(bookingId, 'arrived', 'EN_ROUTE');
  await systemAudit({
    action: 'trip.arrived',
    entity: { type: 'Booking', id: bookingId, code: b.code },
    actor: { id: driverId, role: 'DRIVER' },
    reason: farFlag ? 'far_from_pickup_forced' : undefined,
  });

  const updated = await loadOwnedTrip(driverId, bookingId);
  const trip = await prisma.trip.findUnique({ where: { bookingId } });
  return toDetail(updated, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
}

// ── Begin ride → ONGOING ─────────────────────────────────────────────────────

export async function beginRide(driverId: string, bookingId: string): Promise<DriverTripDetail> {
  const b = await loadOwnedTrip(driverId, bookingId);
  if (b.status === 'ONGOING') {
    const trip = await prisma.trip.findUnique({ where: { bookingId } });
    return toDetail(b, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
  }
  if (b.status !== 'EN_ROUTE') throw Errors.conflict(`cannot_begin_from_${b.status.toLowerCase()}`);
  if (!b.arrivedAt) throw Errors.conflict('must_arrive_first');

  const now = new Date();
  await transitionBooking(bookingId, 'ONGOING', { actorId: driverId, reason: 'driver_begin' });
  await prisma.booking.update({ where: { id: bookingId }, data: { startedAt: now } });
  await setActiveTrip({ bookingId, driverId, code: b.code, status: 'ONGOING', startedAt: now.toISOString() });

  await dispatchBookingNotification({ bookingId, template: 'passenger_ride_started' });
  await fanoutStatus(bookingId, 'ongoing', 'ONGOING');
  await systemAudit({
    action: 'trip.begin',
    entity: { type: 'Booking', id: bookingId, code: b.code },
    actor: { id: driverId, role: 'DRIVER' },
  });

  const updated = await loadOwnedTrip(driverId, bookingId);
  const trip = await prisma.trip.findUnique({ where: { bookingId } });
  return toDetail(updated, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
}

// ── Complete ride → COMPLETED ────────────────────────────────────────────────

export async function completeRide(
  driverId: string,
  bookingId: string,
  note?: string,
): Promise<DriverTripDetail> {
  const b = await loadOwnedTrip(driverId, bookingId);
  if (b.status === 'COMPLETED') {
    const trip = await prisma.trip.findUnique({ where: { bookingId } });
    return toDetail(b, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
  }
  if (b.status !== 'ONGOING') throw Errors.conflict(`cannot_complete_from_${b.status.toLowerCase()}`);

  const now = new Date();
  const startedAt = b.startedAt ?? b.enRouteAt ?? now;
  const actualMin = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60_000));
  const loc = await getHotLocation(driverId);

  await transitionBooking(bookingId, 'COMPLETED', { actorId: driverId, reason: note ? `driver_complete: ${note}` : 'driver_complete' });
  await prisma.booking.update({
    where: { id: bookingId },
    data: { completedAt: now, actualMin },
  });
  await prisma.trip.update({
    where: { bookingId },
    data: { endLat: loc?.lat ?? null, endLng: loc?.lng ?? null, totalMin: actualMin },
  });

  await clearActiveTrip(bookingId, driverId);
  await removeEtaTick(bookingId);

  await prisma.driver.update({
    where: { id: driverId },
    data: { totalTrips: { increment: 1 }, lastTripAt: now, availability: 'ONLINE' },
  });

  // Heavy stats + fraud + summary off the request path.
  await tripFraudQueue.add('fraud', { bookingId }, { jobId: `fraud:${bookingId}` });

  await dispatchBookingNotification({ bookingId, template: 'passenger_ride_completed' });
  await fanoutStatus(bookingId, 'completed', 'COMPLETED');
  await systemAudit({
    action: 'trip.complete',
    entity: { type: 'Booking', id: bookingId, code: b.code },
    actor: { id: driverId, role: 'DRIVER' },
    reason: note,
  });

  const updated = await loadOwnedTrip(driverId, bookingId);
  const trip = await prisma.trip.findUnique({ where: { bookingId } });
  return toDetail(updated, trip ? { totalKm: trip.totalKm, totalMin: trip.totalMin, pingCount: trip.pingCount } : null, null);
}

// ── No-show → NO_SHOW ────────────────────────────────────────────────────────

export async function markNoShow(driverId: string, bookingId: string): Promise<DriverTripDetail> {
  const b = await loadOwnedTrip(driverId, bookingId);
  if (b.status !== 'EN_ROUTE') throw Errors.conflict(`cannot_noshow_from_${b.status.toLowerCase()}`);
  if (!b.arrivedAt) throw Errors.conflict('must_arrive_first');
  if (b.arrivedAt.getTime() > Date.now() - 15 * 60_000) throw Errors.conflict('too_soon_for_noshow');

  const tokenPaid = await tokenPaidOf(bookingId);

  await prisma.cancellation.create({
    data: {
      bookingId,
      cancelledBy: 'OPS',
      reason: 'passenger_no_show',
      policyBucket: 'NO_SHOW',
      feeAmount: tokenPaid,
      refundAmount: 0,
    },
  });
  await transitionBooking(bookingId, 'NO_SHOW', { actorId: driverId, reason: 'passenger_no_show' });
  await clearActiveTrip(bookingId, driverId);
  await removeEtaTick(bookingId);
  await prisma.driver.update({ where: { id: driverId }, data: { availability: 'ONLINE' } });

  await dispatchBookingNotification({ bookingId, template: 'passenger_no_show' });
  await dispatchBookingNotification({
    bookingId,
    template: 'driver_no_show_recorded',
    smsTo: (await prisma.driver.findUnique({ where: { id: driverId } }))?.phone,
    emailTo: null,
  });
  await fanoutStatus(bookingId, 'completed', 'NO_SHOW');
  await systemAudit({
    action: 'trip.no_show',
    entity: { type: 'Booking', id: bookingId, code: b.code },
    actor: { id: driverId, role: 'DRIVER' },
  });

  const updated = await loadOwnedTrip(driverId, bookingId);
  return toDetail(updated, null, null);
}

async function tokenPaidOf(bookingId: string): Promise<number> {
  const payments = await prisma.payment.findMany({ where: { bookingId, type: 'TOKEN', status: 'SUCCESS' } });
  return payments.reduce((sum, p) => sum + p.amountPaid, 0);
}

/** Issue/refresh the shareable track link for a booking (called on assignment). */
export async function ensureTrackLink(bookingId: string): Promise<string | null> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { code: true, scheduledAt: true } });
  if (!b) return null;
  const expiresAt = new Date(b.scheduledAt.getTime() + env.TRACK_LINK_DEFAULT_TTL_HOURS * 3600_000);
  const { url } = await issueTrackToken(bookingId, b.code, expiresAt);
  logger.info({ bookingId }, 'track_link_issued');
  return url;
}

/** REST fallback for a single GPS ping when the realtime socket is unavailable. */
export async function restPing(driverId: string, raw: unknown): Promise<{ ok: boolean }> {
  if (!env.TRACKING_ENABLED) return { ok: false };
  const { ingestPing, recordPingMetric } = await import('../../realtime/location-ingest.js');
  const { fanoutLocation } = await import('../../realtime/io.js');
  const result = await ingestPing(driverId, raw);
  await recordPingMetric(result.ok ? 'accepted' : result.reason);
  if (!result.ok) return { ok: false };
  await fanoutLocation(result.bookingId, result.public);
  return { ok: true };
}
