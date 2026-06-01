import { redis } from '../../redis.js';
import { env } from '../../env.js';
import type { CandidateLocation } from './matching.js';

/**
 * Redis-backed driver presence: heartbeat TTL key + last known coarse location.
 * Postgres holds the durable `Driver.availability` / `lastSeenAt`; Redis holds
 * the fast-decaying liveness + location used by the matching score.
 */

const onlineKey = (driverId: string): string => `driver:online:${driverId}`;
const locKey = (driverId: string): string => `driver:loc:${driverId}`;
const idleKey = (driverId: string): string => `driver:idlesince:${driverId}`;

/** Refresh the heartbeat TTL. Returns the TTL seconds applied. */
export async function touchHeartbeat(driverId: string): Promise<number> {
  const ttl = env.DRIVER_HEARTBEAT_TTL_SEC;
  await redis.set(onlineKey(driverId), Date.now().toString(), 'EX', ttl);
  return ttl;
}

export async function clearHeartbeat(driverId: string): Promise<void> {
  await redis.del(onlineKey(driverId));
}

export async function isHeartbeatAlive(driverId: string): Promise<boolean> {
  return (await redis.exists(onlineKey(driverId))) === 1;
}

/** Store the driver's last known coarse location (TTL 10 min). */
export async function setLocation(driverId: string, lat: number, lng: number): Promise<void> {
  await redis.set(locKey(driverId), JSON.stringify({ lat, lng, at: Date.now() }), 'EX', 600);
}

export async function getLocation(driverId: string): Promise<CandidateLocation | null> {
  const raw = await redis.get(locKey(driverId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { lat: number; lng: number; at: number };
    return { lat: parsed.lat, lng: parsed.lng, ageSec: Math.floor((Date.now() - parsed.at) / 1000) };
  } catch {
    return null;
  }
}

/** Mark the moment a driver went idle (online or finished a trip). */
export async function markIdleSince(driverId: string, at: Date = new Date()): Promise<void> {
  await redis.set(idleKey(driverId), at.getTime().toString());
}

export async function getIdleMinutes(driverId: string): Promise<number> {
  const raw = await redis.get(idleKey(driverId));
  if (!raw) return 0;
  const since = Number(raw);
  if (!Number.isFinite(since)) return 0;
  return Math.max(0, Math.floor((Date.now() - since) / 60000));
}

export async function getRecentDeclineMinutes(driverId: string): Promise<number | null> {
  const raw = await redis.get(`driver:lastdecline:${driverId}`);
  if (!raw) return null;
  const at = Number(raw);
  if (!Number.isFinite(at)) return null;
  return Math.floor((Date.now() - at) / 60000);
}

export async function markRecentDecline(driverId: string): Promise<void> {
  // keep for 60 min — the penalty window
  await redis.set(`driver:lastdecline:${driverId}`, Date.now().toString(), 'EX', 3600);
}
