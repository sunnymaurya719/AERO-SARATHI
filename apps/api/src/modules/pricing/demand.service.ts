/**
 * Demand/supply signal store for surge (Phase 6 §6). Demand is a rolling count
 * of recent quote/booking requests per zone (Redis sorted set, scored by epoch
 * ms). Supply is a periodically-refreshed count of online drivers per zone.
 */
import { redis } from '../../redis.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { getLocation } from '../assignment/driver-presence.js';
import { zoneOf } from './zone.js';

const demandKey = (zone: string): string => `surge:demand:${zone}`;
const supplyKey = (zone: string): string => `surge:supply:${zone}`;

/** Record a demand signal for a zone (called when a quote is requested). */
export async function recordDemand(zone: string): Promise<void> {
  const now = Date.now();
  const key = demandKey(zone);
  try {
    await redis
      .multi()
      .zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 8)}`)
      .expire(key, env.DEMAND_WINDOW_MIN * 60 + 60)
      .exec();
  } catch (err) {
    logger.warn({ err, zone }, 'record_demand_failed');
  }
}

/** Count demand signals within the rolling window. */
export async function demandCount(zone: string): Promise<number> {
  const key = demandKey(zone);
  const cutoff = Date.now() - env.DEMAND_WINDOW_MIN * 60 * 1000;
  try {
    await redis.zremrangebyscore(key, 0, cutoff);
    return await redis.zcard(key);
  } catch (err) {
    logger.warn({ err, zone }, 'demand_count_failed');
    return 0;
  }
}

/** Set the supply count for a zone (called by the refresh worker). */
export async function setSupply(zone: string, count: number): Promise<void> {
  try {
    await redis.set(supplyKey(zone), String(count), 'EX', env.SUPPLY_REFRESH_SEC * 3);
  } catch (err) {
    logger.warn({ err, zone }, 'set_supply_failed');
  }
}

/** Read the supply count for a zone (defaults to 0 when unknown). */
export async function supplyCount(zone: string): Promise<number> {
  try {
    const raw = await redis.get(supplyKey(zone));
    return raw ? Number(raw) : 0;
  } catch (err) {
    logger.warn({ err, zone }, 'supply_count_failed');
    return 0;
  }
}

/**
 * Refresh per-zone supply counts (called by the supply-zone-refresh worker).
 * Counts recently-seen ONLINE drivers, bucketed by their live Redis location.
 */
export async function refreshSupply(): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 60 * 1000);
  const drivers = await prisma.driver.findMany({
    where: { availability: 'ONLINE', lastSeenAt: { gte: cutoff } },
    select: { id: true },
  });

  const counts = new Map<string, number>();
  for (const d of drivers) {
    const loc = await getLocation(d.id);
    if (!loc) continue;
    const zone = zoneOf(loc.lat, loc.lng);
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }
  for (const [zone, n] of counts) await setSupply(zone, n);
  return counts.size;
}
