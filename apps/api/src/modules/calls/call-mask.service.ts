import type { Collection } from 'mongodb';
import { getMongo, connectMongo } from '../../mongo.js';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { Errors } from '../../errors.js';
import { connectMaskedCall } from '../../integrations/exotel.js';

export type CallRole = 'PASSENGER' | 'DRIVER';

interface CallLogDoc {
  bookingId: string;
  fromRole: CallRole;
  exotelSid: string | null;
  status: string;
  durationSec: number | null;
  ts: Date;
}

/** Bookings during which a masked call is permitted. */
const CALL_ACTIVE_STATUSES = new Set(['DRIVER_ASSIGNED', 'EN_ROUTE', 'ONGOING']);

/** PURE: a masked call is only allowed while the trip is live. */
export function isCallAllowed(status: string): boolean {
  return CALL_ACTIVE_STATUSES.has(status);
}

async function logsCollection(): Promise<Collection<CallLogDoc>> {
  const db = getMongo() ?? (await connectMongo());
  return db.collection<CallLogDoc>('call_logs');
}

export async function ensureCallIndexes(): Promise<void> {
  const col = await logsCollection();
  await col.createIndex({ bookingId: 1, ts: 1 });
  await col.createIndex({ exotelSid: 1 });
}

/** Sliding hourly rate limit per (booking, role). Returns true when allowed. */
async function withinRateLimit(bookingId: string, role: CallRole): Promise<boolean> {
  const key = `callrate:${bookingId}:${role}`;
  try {
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 3600);
    return n <= env.CALL_RATE_LIMIT_PER_HOUR;
  } catch (err) {
    logger.warn({ err, bookingId }, 'call_rate_limit_unavailable');
    return true; // fail open — Redis outage shouldn't block a safety feature
  }
}

interface CallBooking {
  status: string;
  userId: string;
  passengerPhone: string;
  driverId: string | null;
}

/**
 * Validate the caller is a party on an ACTIVE booking, bridge the two numbers
 * via Exotel, and write the audit trail (Postgres CallLog + Mongo call_logs).
 */
export async function placeMaskedCall(input: {
  bookingId: string;
  fromRole: CallRole;
  actorId: string;
}): Promise<{ status: string; callId: string }> {
  if (!env.CALLS_ENABLED) throw Errors.forbidden('Calling disabled');

  const booking = (await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: { status: true, userId: true, passengerPhone: true, driverId: true },
  })) as CallBooking | null;

  if (!booking) throw Errors.notFound('Booking not found');
  if (input.fromRole === 'PASSENGER' && booking.userId !== input.actorId) throw Errors.forbidden('Not your booking');
  if (input.fromRole === 'DRIVER' && booking.driverId !== input.actorId) throw Errors.forbidden('Not your trip');
  if (!isCallAllowed(booking.status)) throw Errors.conflict('Calling is not available for this booking');
  if (!booking.driverId) throw Errors.conflict('No driver assigned yet');

  if (!(await withinRateLimit(input.bookingId, input.fromRole))) {
    throw Errors.tooMany('Too many call attempts; try again later');
  }

  const driver = await prisma.driver.findUnique({ where: { id: booking.driverId }, select: { phone: true } });
  if (!driver) throw Errors.conflict('Driver unavailable');

  // The caller's number rings first, then Exotel dials the other party.
  const fromPhone = input.fromRole === 'PASSENGER' ? booking.passengerPhone : driver.phone;
  const toPhone = input.fromRole === 'PASSENGER' ? driver.phone : booking.passengerPhone;

  const result = await connectMaskedCall(fromPhone, toPhone);

  const callLog = await prisma.callLog.create({
    data: {
      bookingId: input.bookingId,
      fromRole: input.fromRole,
      exotelSid: result.sid,
      status: result.status,
    },
  });

  const col = await logsCollection();
  await col.insertOne({
    bookingId: input.bookingId,
    fromRole: input.fromRole,
    exotelSid: result.sid,
    status: result.status,
    durationSec: null,
    ts: new Date(),
  });

  if (result.status === 'failed') {
    // Surface a soft failure so the client can fall back to chat.
    throw Errors.badGateway('Could not place call; use chat instead');
  }

  return { status: result.status, callId: callLog.id };
}

/**
 * Apply an Exotel status webhook: update the CallLog + Mongo call_logs by SID.
 * Idempotent — re-applying the same terminal status is a no-op.
 */
export async function recordCallStatus(input: {
  exotelSid: string;
  status: string;
  durationSec?: number | null;
}): Promise<void> {
  const data: { status: string; durationSec?: number } = { status: input.status };
  if (typeof input.durationSec === 'number') data.durationSec = input.durationSec;

  await prisma.callLog.updateMany({ where: { exotelSid: input.exotelSid }, data });

  const col = await logsCollection();
  await col.updateMany(
    { exotelSid: input.exotelSid },
    { $set: { status: input.status, durationSec: input.durationSec ?? null } },
  );
}
