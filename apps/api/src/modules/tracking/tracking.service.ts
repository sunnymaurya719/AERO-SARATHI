import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { getDirections } from '../../integrations/google-directions.js';
import { getHotLocation, toPublicLocation, getEta } from './location-store.js';
import { readTripSummary } from './ride-logs.store.js';
import { encodePolyline, type LatLng } from './geo.js';
import type { TrackSnapshot, TrackStage, TrackRoute, TripSummary, BookingStatus } from '@aero/types';

/**
 * Read-side for the public tracking page (Phase 5 §10). Resolves a booking by
 * `code` (the token already authorised the request in the router) and returns
 * a sanitised snapshot — no driver phone, no internal ids.
 */

function maskPhone(phone: string): string {
  return phone.length >= 6 ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : '****';
}

function stageOf(status: BookingStatus, arrivedAt: Date | null): TrackStage {
  switch (status) {
    case 'DRIVER_ASSIGNED':
      return 'assigned';
    case 'EN_ROUTE':
      return arrivedAt ? 'arrived' : 'en_route';
    case 'ONGOING':
      return 'ongoing';
    case 'COMPLETED':
    case 'NO_SHOW':
    case 'CANCELLED':
      return 'completed';
    default:
      return 'assigned';
  }
}

const TERMINAL: BookingStatus[] = ['COMPLETED', 'NO_SHOW', 'CANCELLED'];

export async function buildSnapshot(bookingId: string): Promise<TrackSnapshot> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { driver: true, vehicle: true, trip: true },
  });
  if (!booking) throw Errors.notFound('booking_not_found');

  const ended = TERMINAL.includes(booking.status as BookingStatus);
  const stage = stageOf(booking.status as BookingStatus, booking.arrivedAt);

  let location = null;
  let eta = null;
  if (!ended && booking.driverId) {
    const hot = await getHotLocation(booking.driverId);
    if (hot) location = toPublicLocation(hot);
    eta = await getEta(bookingId);
  }

  let summary: TripSummary | null = null;
  if (ended) {
    const doc = await readTripSummary(bookingId);
    summary = {
      actualKm: booking.actualKm ?? doc?.totalKm ?? null,
      actualMin: booking.actualMin ?? doc?.totalMin ?? null,
      estimatedKm: booking.estimatedKm ?? 0,
      estimatedMin: booking.estimatedMin ?? 0,
      topSpeedKmh: booking.trip?.topSpeedKmh ?? null,
      completedAt: booking.completedAt?.toISOString() ?? null,
    };
  }

  return {
    code: booking.code,
    stage,
    status: booking.status as BookingStatus,
    scheduledAt: booking.scheduledAt.toISOString(),
    pickup: { address: booking.pickupAddress, lat: booking.pickupLat, lng: booking.pickupLng },
    drop: { address: booking.dropAddress, lat: booking.dropLat, lng: booking.dropLng },
    driver:
      booking.driver && !ended
        ? {
            name: booking.driver.name,
            phoneMasked: maskPhone(booking.driver.phone),
            carModel: booking.vehicle?.model ?? null,
            plate: booking.vehicle?.regNo ?? null,
          }
        : null,
    location,
    eta,
    ended,
    summary,
  };
}

/** Encoded-polyline route from pickup to drop, cached 24h per coordinate pair. */
export async function buildRoute(bookingId: string): Promise<TrackRoute> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { pickupLat: true, pickupLng: true, dropLat: true, dropLng: true },
  });
  if (!booking) throw Errors.notFound('booking_not_found');

  const cacheKey = `track:route:${bookingId}`;
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as TrackRoute;

  const pickup: LatLng = { lat: booking.pickupLat, lng: booking.pickupLng };
  const drop: LatLng = { lat: booking.dropLat, lng: booking.dropLng };
  const dir = await getDirections(pickup, drop, new Date());

  // The dev fallback has no polyline; encode a straight line so the map renders.
  const polyline =
    'polyline' in dir && typeof (dir as { polyline?: string }).polyline === 'string'
      ? (dir as { polyline: string }).polyline
      : encodePolyline([pickup, drop]);

  const route: TrackRoute = { polyline, distanceKm: dir.distanceKm, durationMin: dir.durationMin };
  await redis.set(cacheKey, JSON.stringify(route), 'EX', env.TRACK_LINK_DEFAULT_TTL_HOURS * 3600);
  return route;
}
