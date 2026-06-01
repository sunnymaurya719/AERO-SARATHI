import { z } from 'zod';
import { redis } from '../redis.js';
import { logger } from '../logger.js';
import { prisma } from '../prisma.js';
import { insideIndia, haversineM } from '../modules/tracking/geo.js';
import {
  setHotLocation,
  getHotLocation,
  getActiveTripByDriver,
  toPublicLocation,
  type HotLocation,
} from '../modules/tracking/location-store.js';
import { appendRideLog } from '../modules/tracking/ride-logs.store.js';
import type { PublicLocation } from '@aero/types';

/**
 * Location ingest pipeline (Phase 5 §7). Validates a raw driver ping, clamps /
 * sanity-checks it, writes the Redis hot store + Mongo cold store, and returns
 * the trimmed public location to broadcast — or a reject reason.
 */

export const LocationPingSchema = z.object({
  bookingId: z.string().uuid(),
  clientSeq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  lat: z.number().finite(),
  lng: z.number().finite(),
  accuracyM: z.number().finite().nonnegative(),
  speedKmh: z.number().finite().nonnegative().nullable().optional(),
  headingDeg: z.number().finite().nullable().optional(),
  altitudeM: z.number().finite().nullable().optional(),
  batteryPct: z.number().finite().nullable().optional(),
  source: z.enum(['gps', 'wifi', 'network', 'unknown']).optional(),
});

export type RawPing = z.infer<typeof LocationPingSchema>;

export type IngestResult =
  | { ok: true; bookingId: string; public: PublicLocation; phase: 'EN_ROUTE' | 'ONGOING' | 'idle' }
  | { ok: false; reason: string };

const MAX_SPEED_KMH = 200;
const MAX_ACCURACY_M = 200;
const dedupKey = (driverId: string, seq: number): string => `loc:seq:${driverId}:${seq}`;
const throttleKey = (driverId: string): string => `loc:throttle:${driverId}`;

/** Server-side defensive throttle: drop > 1 ping / 2s per driver. */
async function throttled(driverId: string): Promise<boolean> {
  const set = await redis.set(throttleKey(driverId), '1', 'PX', 2000, 'NX');
  return set !== 'OK';
}

/**
 * Validate + clamp a ping and persist it. `driverId` comes from the authed
 * socket — never trust the client for identity. Throttle is bypassed for the
 * REST fallback path (it dedupes by clientSeq instead).
 */
export async function ingestPing(
  driverId: string,
  raw: unknown,
  opts: { skipThrottle?: boolean } = {},
): Promise<IngestResult> {
  const parsed = LocationPingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'schema' };
  const ping = parsed.data;

  const now = Date.now();
  const tsMs = new Date(ping.ts).getTime();
  if (!Number.isFinite(tsMs)) return { ok: false, reason: 'bad_ts' };
  if (tsMs > now + 5000) return { ok: false, reason: 'future_ts' };
  if (tsMs < now - 60_000) return { ok: false, reason: 'stale_ts' };

  if (ping.accuracyM > MAX_ACCURACY_M) return { ok: false, reason: 'low_accuracy' };
  if (ping.speedKmh != null && ping.speedKmh > MAX_SPEED_KMH) return { ok: false, reason: 'impossible_speed' };
  if (!insideIndia({ lat: ping.lat, lng: ping.lng })) return { ok: false, reason: 'out_of_country' };

  // Dedup by (driverId, clientSeq) within 60s.
  const seqSet = await redis.set(dedupKey(driverId, ping.clientSeq), '1', 'EX', 60, 'NX');
  if (seqSet !== 'OK') return { ok: false, reason: 'dup_seq' };

  if (!opts.skipThrottle && (await throttled(driverId))) return { ok: false, reason: 'throttle' };

  // Teleport guard vs the previous hot location.
  const prev = await getHotLocation(driverId);
  if (prev) {
    const gapSec = Math.max(1, (tsMs - prev.ts) / 1000);
    const distM = haversineM(prev, { lat: ping.lat, lng: ping.lng });
    const maxAllowedM = (MAX_SPEED_KMH / 3.6) * gapSec + 50;
    if (distM > maxAllowedM) return { ok: false, reason: 'teleport' };
  }

  const hot: HotLocation = {
    lat: ping.lat,
    lng: ping.lng,
    headingDeg: ping.headingDeg ?? null,
    speedKmh: ping.speedKmh ?? null,
    accuracyM: ping.accuracyM,
    ts: tsMs,
  };
  await setHotLocation(driverId, hot);

  // Look up the driver's active trip; only log to Mongo during EN_ROUTE/ONGOING.
  const active = await getActiveTripByDriver(driverId);
  let phase: 'EN_ROUTE' | 'ONGOING' | 'idle' = 'idle';
  if (active && active.bookingId === ping.bookingId) {
    phase = active.status;
    await appendRideLog({
      bookingId: ping.bookingId,
      driverId,
      vehicleId: null,
      ts: new Date(tsMs),
      lat: ping.lat,
      lng: ping.lng,
      accuracyM: ping.accuracyM,
      speedKmh: ping.speedKmh ?? null,
      headingDeg: ping.headingDeg ?? null,
      altitudeM: ping.altitudeM ?? null,
      batteryPct: ping.batteryPct ?? null,
      phase,
      source: ping.source ?? 'gps',
      clientSeq: ping.clientSeq,
    });
    // Bump cheap counters (best-effort).
    void prisma.trip
      .update({ where: { bookingId: ping.bookingId }, data: { pingCount: { increment: 1 } } })
      .catch(() => undefined);
  }

  return { ok: true, bookingId: ping.bookingId, public: toPublicLocation(hot), phase };
}

/** Counter increment for observability — accepted / dropped pings. */
export async function recordPingMetric(result: 'accepted' | string): Promise<void> {
  const bucket = result === 'accepted' ? 'accepted' : `dropped_${result}`;
  await redis.incr(`metric:loc_pings:${bucket}`).catch(() => undefined);
}
