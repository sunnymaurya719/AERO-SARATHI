import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { getDirections } from '../../integrations/google-directions.js';
import { getHotLocation, setEta, type HotLocation } from './location-store.js';
import { fanoutEta } from '../../realtime/io.js';
import { haversineKm, roundCoord } from './geo.js';
import type { EtaUpdate } from '@aero/types';

/**
 * ETA recomputation (Phase 5 §7.4). Called by the eta-tick worker per active
 * trip. Cost-controlled: rounds coordinates for cache reuse, honours a daily
 * Directions budget, and falls back to a haversine estimate when stale/over-budget.
 */

const budgetKey = (): string => `eta:budget:${new Date().toISOString().slice(0, 10)}`;
const etaCacheKey = (bookingId: string, phase: string, lat: number, lng: number): string =>
  `eta:cache:${bookingId}:${phase}:${roundCoord(lat)},${roundCoord(lng)}`;

const FALLBACK_AVG_KMH = 35;

async function spentInr(): Promise<number> {
  const raw = await redis.get(budgetKey());
  return raw ? Number(raw) : 0;
}

async function chargeBudget(): Promise<void> {
  const key = budgetKey();
  const next = await redis.incrbyfloat(key, env.ETA_DIRECTIONS_UNIT_INR);
  // First write of the day: set a 26h expiry so the counter self-cleans.
  if (Number(next) <= env.ETA_DIRECTIONS_UNIT_INR + 0.0001) {
    await redis.expire(key, 26 * 3600);
  }
}

function haversineEta(driver: HotLocation, target: { lat: number; lng: number }): number {
  const km = haversineKm(driver, target) * 1.4; // road factor
  return Math.max(1, Math.round((km / FALLBACK_AVG_KMH) * 60));
}

/**
 * Recompute the ETA for one active booking and broadcast it. Returns the result
 * kind for observability.
 */
export async function recomputeEta(
  bookingId: string,
): Promise<'cached' | 'computed' | 'budget_skip' | 'stale_loc_skip' | 'no_booking'> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { driverId: true, status: true, arrivedAt: true, pickupLat: true, pickupLng: true, dropLat: true, dropLng: true },
  });
  if (!booking || !booking.driverId) return 'no_booking';
  if (booking.status !== 'EN_ROUTE' && booking.status !== 'ONGOING') return 'no_booking';

  const driver = await getHotLocation(booking.driverId);
  if (!driver || Date.now() - driver.ts > 60_000) return 'stale_loc_skip';

  const toPickup = booking.arrivedAt == null && booking.status === 'EN_ROUTE';
  const target = toPickup
    ? { lat: booking.pickupLat, lng: booking.pickupLng }
    : { lat: booking.dropLat, lng: booking.dropLng };
  const phase: EtaUpdate['phase'] = toPickup ? 'to_pickup' : 'to_drop';

  // Cache check (rounded coords → nearby trips share a key).
  const cacheKey = etaCacheKey(bookingId, phase, driver.lat, driver.lng);
  const cached = await redis.get(cacheKey);
  let minutes: number;
  let approx = false;
  let kind: 'cached' | 'computed' | 'budget_skip';

  if (cached) {
    minutes = Number(cached);
    kind = 'cached';
  } else if ((await spentInr()) >= env.ETA_DAILY_BUDGET_INR) {
    minutes = haversineEta(driver, target);
    approx = true;
    kind = 'budget_skip';
  } else {
    try {
      const dir = await getDirections({ lat: driver.lat, lng: driver.lng }, target, new Date());
      minutes = dir.durationMin;
      await redis.set(cacheKey, String(minutes), 'EX', 60);
      if (env.GOOGLE_MAPS_API_KEY) await chargeBudget();
      kind = 'computed';
    } catch (err) {
      logger.warn({ err: (err as Error).message, bookingId }, 'eta_directions_failed');
      minutes = haversineEta(driver, target);
      approx = true;
      kind = 'computed';
    }
  }

  const eta: EtaUpdate = { phase, minutes, approx, computedAt: new Date().toISOString() };
  await setEta(bookingId, eta);
  await fanoutEta(bookingId, eta);
  return kind;
}

/**
 * Cadence is faster when more trips are active (cache hit rate climbs): base
 * 60s, busy 30s (>= 20 trips), hot 15s (>= 100 trips).
 */
export async function currentEtaCadenceSec(): Promise<number> {
  const active = await prisma.booking.count({ where: { status: { in: ['EN_ROUTE', 'ONGOING'] } } });
  if (active >= 100) return env.ETA_TICK_HOT_SEC;
  if (active >= 20) return env.ETA_TICK_BUSY_SEC;
  return env.ETA_TICK_BASE_SEC;
}
