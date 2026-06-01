import { redis } from '../../redis.js';
import type { PublicLocation, EtaUpdate } from '@aero/types';

/**
 * Redis hot-store for live tracking (Phase 5 §5.3). All keys are short-TTL — the
 * store is "live or nothing"; durable history lives in Postgres/Mongo.
 */

const locKey = (driverId: string): string => `driver:loc:${driverId}`;
const activeKey = (bookingId: string): string => `booking:active:${bookingId}`;
const activeByDriverKey = (driverId: string): string => `driver:active:${driverId}`;
const etaKey = (bookingId: string): string => `eta:${bookingId}`;

export interface HotLocation {
  lat: number;
  lng: number;
  headingDeg: number | null;
  speedKmh: number | null;
  accuracyM: number;
  ts: number; // epoch ms
}

/** Overwrite the latest high-accuracy location (TTL 30s). */
export async function setHotLocation(driverId: string, loc: HotLocation): Promise<void> {
  await redis.set(locKey(driverId), JSON.stringify(loc), 'EX', 30);
}

export async function getHotLocation(driverId: string): Promise<HotLocation | null> {
  const raw = await redis.get(locKey(driverId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HotLocation;
  } catch {
    return null;
  }
}

/** Trimmed location safe to broadcast to passenger/track rooms. */
export function toPublicLocation(loc: HotLocation): PublicLocation {
  return {
    lat: loc.lat,
    lng: loc.lng,
    headingDeg: loc.headingDeg,
    speedKmh: loc.speedKmh,
    ts: new Date(loc.ts).toISOString(),
  };
}

export interface ActiveTrip {
  bookingId: string;
  driverId: string;
  code: string;
  status: 'EN_ROUTE' | 'ONGOING';
  startedAt: string;
}

/** Mark a booking as the driver's active trip (TTL 8h). */
export async function setActiveTrip(trip: ActiveTrip): Promise<void> {
  const payload = JSON.stringify(trip);
  await redis.set(activeKey(trip.bookingId), payload, 'EX', 8 * 3600);
  await redis.set(activeByDriverKey(trip.driverId), payload, 'EX', 8 * 3600);
}

export async function getActiveTrip(bookingId: string): Promise<ActiveTrip | null> {
  const raw = await redis.get(activeKey(bookingId));
  return raw ? (JSON.parse(raw) as ActiveTrip) : null;
}

export async function getActiveTripByDriver(driverId: string): Promise<ActiveTrip | null> {
  const raw = await redis.get(activeByDriverKey(driverId));
  return raw ? (JSON.parse(raw) as ActiveTrip) : null;
}

export async function clearActiveTrip(bookingId: string, driverId: string): Promise<void> {
  await redis.del(activeKey(bookingId), activeByDriverKey(driverId));
}

/** Persist the last computed ETA (TTL 60s). */
export async function setEta(bookingId: string, eta: EtaUpdate): Promise<void> {
  await redis.set(etaKey(bookingId), JSON.stringify(eta), 'EX', 60);
}

export async function getEta(bookingId: string): Promise<EtaUpdate | null> {
  const raw = await redis.get(etaKey(bookingId));
  return raw ? (JSON.parse(raw) as EtaUpdate) : null;
}
