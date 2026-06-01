import { getMongo } from '../../mongo.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import type { LatLng } from './geo.js';

/**
 * Mongo cold-store for GPS pings (Phase 5 §5.2). `ride_logs` is append-only and
 * carries a 90-day TTL on `ts`; `trip_summaries` holds the reduced polyline kept
 * forever; `sos_events` mirrors the Postgres row with contextual snapshots.
 */

export interface RideLogDoc {
  bookingId: string;
  driverId: string;
  vehicleId: string | null;
  ts: Date;
  lat: number;
  lng: number;
  accuracyM: number;
  speedKmh: number | null;
  headingDeg: number | null;
  altitudeM: number | null;
  batteryPct: number | null;
  phase: 'EN_ROUTE' | 'ONGOING';
  source: string;
  clientSeq: number;
}

let indexesEnsured = false;

/** Idempotently create the ride_logs / trip_summaries / sos_events indexes. */
export async function ensureRideLogIndexes(): Promise<void> {
  const db = getMongo();
  if (!db || indexesEnsured) return;
  try {
    await db.collection('ride_logs').createIndex({ bookingId: 1, ts: 1 });
    await db.collection('ride_logs').createIndex({ driverId: 1, ts: -1 });
    await db
      .collection('ride_logs')
      .createIndex({ ts: 1 }, { expireAfterSeconds: env.RIDE_LOG_TTL_DAYS * 86_400 });
    await db.collection('trip_summaries').createIndex({ bookingId: 1 }, { unique: true });
    await db.collection('sos_events').createIndex({ bookingId: 1, createdAt: -1 });
    indexesEnsured = true;
    logger.info('ride_log_indexes_ensured');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'ride_log_index_failed');
  }
}

/** Append a single GPS ping. Never throws to the ingest hot path. */
export async function appendRideLog(doc: RideLogDoc): Promise<void> {
  const db = getMongo();
  if (!db) return;
  try {
    await db.collection('ride_logs').insertOne(doc);
  } catch (err) {
    logger.warn({ err: (err as Error).message, bookingId: doc.bookingId }, 'ride_log_insert_failed');
  }
}

export interface RidePoint {
  ts: Date;
  lat: number;
  lng: number;
  accuracyM: number;
  speedKmh: number | null;
  phase: string;
}

/** Read all pings for a booking between two timestamps, ordered by ts. */
export async function readRideLogs(
  bookingId: string,
  from?: Date,
  to?: Date,
): Promise<RidePoint[]> {
  const db = getMongo();
  if (!db) return [];
  const filter: Record<string, unknown> = { bookingId };
  if (from || to) {
    const ts: Record<string, Date> = {};
    if (from) ts.$gte = from;
    if (to) ts.$lte = to;
    filter.ts = ts;
  }
  const docs = await db
    .collection<RideLogDoc>('ride_logs')
    .find(filter)
    .sort({ ts: 1 })
    .toArray();
  return docs.map((d) => ({
    ts: d.ts,
    lat: d.lat,
    lng: d.lng,
    accuracyM: d.accuracyM,
    speedKmh: d.speedKmh,
    phase: d.phase,
  }));
}

export interface TripSummaryDoc {
  bookingId: string;
  driverId: string;
  polyline: LatLng[];
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number } | null;
  totalKm: number | null;
  totalMin: number | null;
  pointCount: number;
  createdAt: Date;
}

/** Upsert the per-booking trip summary (one doc, kept forever). */
export async function writeTripSummary(doc: TripSummaryDoc): Promise<void> {
  const db = getMongo();
  if (!db) return;
  try {
    await db
      .collection('trip_summaries')
      .updateOne({ bookingId: doc.bookingId }, { $set: doc }, { upsert: true });
  } catch (err) {
    logger.warn({ err: (err as Error).message, bookingId: doc.bookingId }, 'trip_summary_write_failed');
  }
}

export async function readTripSummary(bookingId: string): Promise<TripSummaryDoc | null> {
  const db = getMongo();
  if (!db) return null;
  return db.collection<TripSummaryDoc>('trip_summaries').findOne({ bookingId });
}

export interface SosEventDoc {
  sosEventId: string;
  bookingId: string;
  bookingCode: string;
  triggeredBy: string;
  lat: number | null;
  lng: number | null;
  message: string | null;
  driverLoc: { lat: number; lng: number; ageSec: number } | null;
  recentPings: RidePoint[];
  userAgent: string | null;
  createdAt: Date;
}

/** Write the richer SOS context snapshot to Mongo. */
export async function writeSosEvent(doc: SosEventDoc): Promise<void> {
  const db = getMongo();
  if (!db) return;
  try {
    await db.collection('sos_events').insertOne(doc);
  } catch (err) {
    logger.warn({ err: (err as Error).message, bookingId: doc.bookingId }, 'sos_event_write_failed');
  }
}
