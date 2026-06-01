import { Prisma } from '@aero/db';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { systemAudit } from '../../middleware/audit.js';
import { readRideLogs, writeTripSummary } from '../tracking/ride-logs.store.js';
import { haversineKm, simplifyPath, type LatLng } from '../tracking/geo.js';
import { evaluateFraud, type FraudPing } from './fraud.js';
import { applyPerTripCut } from '../emi/emi.service.js';
import { recordTripEarning } from '../earnings/earnings.service.js';
import { enqueueReferralCredit } from '../../queues/phase6.queues.js';
import { writeEvent } from '../../analytics/events.js';

/**
 * Post-completion trip stats + anti-fraud (Phase 5 §8.4/§9). Runs off the
 * request path in the `trip-fraud-check` worker: reads the cold ride log,
 * derives distance/speed/gaps, scores fraud, writes the Trip row + summary, and
 * raises a TRIP_FRAUD_REVIEW alert when over threshold.
 */

const GAP_THRESHOLD_MS = 30_000;
const ACCURACY_LIMIT_M = 50;

export async function finalizeTripStats(bookingId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { trip: true },
  });
  if (!booking || !booking.trip) {
    logger.warn({ bookingId }, 'finalize_stats_no_trip');
    return;
  }

  const points = await readRideLogs(bookingId);
  const pickup: LatLng = { lat: booking.pickupLat, lng: booking.pickupLng };
  const drop: LatLng = { lat: booking.dropLat, lng: booking.dropLng };

  // Distance from clean points (ignore low-accuracy fixes), speed + gap stats.
  let totalKm = 0;
  let topSpeed = 0;
  let gapCount = 0;
  const clean = points.filter((p) => p.accuracyM <= ACCURACY_LIMIT_M);
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1]!;
    const b = clean[i]!;
    totalKm += haversineKm(a, b);
    if (typeof b.speedKmh === 'number' && b.speedKmh > topSpeed) topSpeed = b.speedKmh;
  }
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.ts.getTime() - points[i - 1]!.ts.getTime() > GAP_THRESHOLD_MS) gapCount++;
  }
  totalKm = Math.round(totalKm * 100) / 100;

  const actualMin = booking.actualMin ?? booking.trip.totalMin ?? 0;
  const avgSpeed = actualMin > 0 ? Math.round((totalKm / (actualMin / 60)) * 10) / 10 : 0;

  const fraudPings: FraudPing[] = points.map((p) => ({
    ts: p.ts,
    lat: p.lat,
    lng: p.lng,
    accuracyM: p.accuracyM,
    speedKmh: p.speedKmh,
  }));
  const fraud = evaluateFraud({
    pings: fraudPings,
    pickup,
    drop,
    arrivedLoc:
      booking.trip.pickupReachedLat != null && booking.trip.pickupReachedLng != null
        ? { lat: booking.trip.pickupReachedLat, lng: booking.trip.pickupReachedLng }
        : null,
    actualKm: totalKm,
    actualMin,
  });

  const reviewStatus =
    env.FRAUD_AUTO_REVIEW && fraud.score >= env.FRAUD_FLAG_REVIEW_THRESHOLD ? 'PENDING_REVIEW' : 'NONE';

  await prisma.trip.update({
    where: { bookingId },
    data: {
      totalKm,
      totalMin: actualMin,
      topSpeedKmh: topSpeed || null,
      avgSpeedKmh: avgSpeed || null,
      pingCount: points.length,
      gapCount,
      fraudScore: fraud.score,
      fraudFlags: fraud.flags as unknown as Prisma.InputJsonValue,
      reviewStatus,
    },
  });
  await prisma.booking.update({ where: { id: bookingId }, data: { actualKm: totalKm } });

  // Persist the simplified path for replay (kept forever).
  const polyline = simplifyPath(points.map((p) => ({ lat: p.lat, lng: p.lng })));
  const bounds = polyline.length
    ? polyline.reduce(
        (acc, p) => ({
          minLat: Math.min(acc.minLat, p.lat),
          minLng: Math.min(acc.minLng, p.lng),
          maxLat: Math.max(acc.maxLat, p.lat),
          maxLng: Math.max(acc.maxLng, p.lng),
        }),
        { minLat: 90, minLng: 180, maxLat: -90, maxLng: -180 },
      )
    : null;
  await writeTripSummary({
    bookingId,
    driverId: booking.trip.driverId,
    polyline,
    bounds,
    totalKm,
    totalMin: actualMin,
    pointCount: points.length,
    createdAt: new Date(),
  });

  if (reviewStatus === 'PENDING_REVIEW') {
    await prisma.systemAlert.create({
      data: {
        type: 'TRIP_FRAUD_REVIEW',
        severity: 'WARNING',
        entityType: 'Booking',
        entityId: bookingId,
        payload: {
          bookingCode: booking.code,
          score: fraud.score,
          flags: fraud.flags,
        } as unknown as Prisma.InputJsonValue,
        status: 'OPEN',
      },
    });
    await systemAudit({
      action: 'trip.fraud_flagged',
      entity: { type: 'Booking', id: bookingId, code: booking.code },
      reason: `score ${fraud.score.toFixed(2)}`,
      after: { score: fraud.score, flags: fraud.flags },
    });
  }

  logger.info({ bookingId, totalKm, score: fraud.score, gapCount }, 'trip_stats_finalized');

  // Phase 6 money + engagement hooks (each isolated; failures never block stats).
  const driverId = booking.trip.driverId;
  try {
    await recordTripEarning({ driverId, bookingId, grossPaise: BigInt(booking.fareTotal) });
  } catch (err) {
    logger.error({ err, bookingId }, 'trip_earning_failed');
  }
  try {
    await applyPerTripCut({ driverId, bookingId });
  } catch (err) {
    logger.error({ err, bookingId }, 'emi_cut_failed');
  }
  if (env.REFERRAL_ENABLED) {
    try {
      await enqueueReferralCredit(booking.userId);
    } catch (err) {
      logger.error({ err, bookingId }, 'referral_credit_enqueue_failed');
    }
  }
  void writeEvent('trip_completed', { bookingId, driverId, totalKm, fareTotal: booking.fareTotal }, { userId: booking.userId });
}
