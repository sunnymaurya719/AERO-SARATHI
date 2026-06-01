/**
 * Nightly analytics rollup (Phase 6 §7.2). Aggregates the previous day's funnel
 * from Mongo `analytics_events` and money facts from Postgres into a single
 * `DailyMetric` row per (date, dimension). Idempotent via upsert.
 */
import { prisma } from '../prisma.js';
import { getMongo, connectMongo } from '../mongo.js';
import { logger } from '../logger.js';

/** PURE: average order value = gmv / trips (0 when no trips). */
export function avgOrderValue(gmvPaise: bigint, trips: number): bigint {
  if (trips <= 0) return 0n;
  return gmvPaise / BigInt(trips);
}

/** UTC day window [start, end) for a given date. */
export function dayWindow(date: Date): { start: Date; end: Date; key: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key: start };
}

async function mongoEventCount(event: string, start: Date, end: Date): Promise<number> {
  const db = getMongo() ?? (await connectMongo());
  return db.collection('analytics_events').countDocuments({ event, ts: { $gte: start, $lt: end } });
}

/** Compute and upsert the DailyMetric for the given date (default: yesterday). */
export async function rollupDay(forDate?: Date): Promise<void> {
  const base = forDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { start, end, key } = dayWindow(base);

  const completed = await prisma.booking.findMany({
    where: { status: 'COMPLETED', completedAt: { gte: start, lt: end } },
    select: { fareTotal: true },
  });
  const trips = completed.length;
  const gmvPaise = completed.reduce((s, b) => s + BigInt(b.fareTotal), 0n);

  const bookingsCount = await prisma.booking.count({ where: { createdAt: { gte: start, lt: end } } });
  const cancellations = await prisma.booking.count({ where: { status: 'CANCELLED', cancelledAt: { gte: start, lt: end } } });
  const surgeTrips = await prisma.quote.count({ where: { createdAt: { gte: start, lt: end }, surgeMultiplier: { gt: 1.0 } } });
  const surgeAgg = await prisma.quote.aggregate({ where: { createdAt: { gte: start, lt: end } }, _avg: { surgeMultiplier: true } });

  let quotes = 0;
  let noShows = 0;
  try {
    quotes = await mongoEventCount('quote_created', start, end);
    noShows = await mongoEventCount('no_show', start, end);
  } catch (err) {
    logger.warn({ err }, 'rollup_mongo_funnel_failed');
  }

  await prisma.dailyMetric.upsert({
    where: { date_dimension: { date: key, dimension: 'global' } },
    create: {
      date: key,
      dimension: 'global',
      trips,
      gmvPaise,
      aovPaise: avgOrderValue(gmvPaise, trips),
      quotes,
      bookings: bookingsCount,
      cancellations,
      noShows,
      refundsPaise: 0n,
      surgeTripCount: surgeTrips,
      avgSurge: surgeAgg._avg.surgeMultiplier ?? 1.0,
      driverActive: 0,
      acceptanceRate: 0,
      utilization: 0,
    },
    update: {
      trips,
      gmvPaise,
      aovPaise: avgOrderValue(gmvPaise, trips),
      quotes,
      bookings: bookingsCount,
      cancellations,
      noShows,
      surgeTripCount: surgeTrips,
      avgSurge: surgeAgg._avg.surgeMultiplier ?? 1.0,
    },
  });

  logger.info({ date: key.toISOString().slice(0, 10), trips, gmvPaise: gmvPaise.toString() }, 'rollup_day_complete');
}
