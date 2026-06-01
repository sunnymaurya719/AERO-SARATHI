import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { Errors } from '../../errors.js';
import { logger } from '../../logger.js';
import { Prisma } from '@aero/db';
import type { SosActor } from '@aero/db';
import { postToSlack } from '../../integrations/slack.js';
import { systemAudit } from '../../middleware/audit.js';
import { writeSosEvent } from './ride-logs.store.js';
import { readRideLogs } from './ride-logs.store.js';
import { getHotLocation } from './location-store.js';
import { emitSosToAdmin } from '../../realtime/io.js';
import { insideIndia } from './geo.js';

/**
 * SOS handling (Phase 5 §11). Anyone holding a valid track token can raise an
 * SOS for that booking. We rate-limit per booking, persist a SosEvent, raise a
 * CRITICAL SystemAlert, page ops on Slack, and mirror to the cold store.
 */

export interface RaiseSosInput {
  bookingId: string;
  triggeredBy: SosActor;
  lat?: number;
  lng?: number;
  message?: string;
  userAgent?: string | null;
}

export async function raiseSos(input: RaiseSosInput): Promise<{ id: string }> {
  const cooldownKey = `sos:cooldown:${input.bookingId}`;
  const ok = await redis.set(cooldownKey, '1', 'EX', 60, 'NX');
  if (ok !== 'OK') throw Errors.tooMany('sos_cooldown');

  const booking = await prisma.booking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, code: true, driverId: true },
  });
  if (!booking) throw Errors.notFound('booking_not_found');

  const lat =
    typeof input.lat === 'number' && typeof input.lng === 'number' && insideIndia({ lat: input.lat, lng: input.lng })
      ? input.lat
      : null;
  const lng = lat !== null ? (input.lng ?? null) : null;

  const alert = await prisma.systemAlert.create({
    data: {
      type: 'SOS_TRIGGERED',
      severity: 'CRITICAL',
      entityType: 'Booking',
      entityId: booking.id,
      payload: {
        bookingCode: booking.code,
        triggeredBy: input.triggeredBy,
        lat,
        lng,
        message: input.message ?? null,
      } as unknown as Prisma.InputJsonValue,
      status: 'OPEN',
    },
  });

  const sos = await prisma.sosEvent.create({
    data: {
      bookingId: booking.id,
      triggeredBy: input.triggeredBy,
      lat,
      lng,
      message: input.message ?? null,
      alertId: alert.id,
    },
  });

  // Cold store mirror + ops paging (best-effort).
  const hot = booking.driverId ? await getHotLocation(booking.driverId) : null;
  const recentPings = (await readRideLogs(booking.id)).slice(-10);
  await writeSosEvent({
    sosEventId: sos.id,
    bookingId: booking.id,
    bookingCode: booking.code,
    triggeredBy: input.triggeredBy,
    lat,
    lng,
    message: input.message ?? null,
    driverLoc: hot ? { lat: hot.lat, lng: hot.lng, ageSec: Math.round((Date.now() - hot.ts) / 1000) } : null,
    recentPings,
    userAgent: input.userAgent ?? null,
    createdAt: new Date(),
  });

  void postToSlack(
    `:rotating_light: *SOS* on booking ${booking.code} by ${input.triggeredBy}` +
      (lat !== null ? ` @ https://maps.google.com/?q=${lat},${lng}` : '') +
      (input.message ? `\n> ${input.message}` : ''),
  );

  emitSosToAdmin({
    id: sos.id,
    bookingId: booking.id,
    bookingCode: booking.code,
    triggeredBy: input.triggeredBy,
    lat,
    lng,
    message: input.message ?? null,
    createdAt: sos.createdAt.toISOString(),
  });

  await systemAudit({
    action: 'sos.raised',
    entity: { type: 'Booking', id: booking.id, code: booking.code },
    actor: { id: booking.driverId ?? 'public', role: input.triggeredBy },
    reason: input.message,
  });

  logger.warn({ bookingId: booking.id, by: input.triggeredBy }, 'sos_raised');
  return { id: sos.id };
}
