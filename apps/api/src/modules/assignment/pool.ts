import { Prisma } from '@aero/db';
import type { Booking } from '@aero/db';
import { prisma } from '../../prisma.js';
import type { MatchCandidate } from './matching.js';
import { getLocation, getIdleMinutes, getRecentDeclineMinutes } from './driver-presence.js';

/**
 * Builds the eligible candidate pool for a booking. The hard gates from
 * §6.1 are enforced in a single SQL query (fast, index-friendly); realtime
 * features (location, idle, recent-decline) are then enriched from Redis.
 */

interface PoolRow {
  id: string;
  rating: number | null;
  homeCity: string;
  acceptanceRate: number | null;
  offersHistorical: number | null;
}

export async function buildPool(booking: Booking): Promise<MatchCandidate[]> {
  const rows = await prisma.$queryRaw<PoolRow[]>(Prisma.sql`
    SELECT d."id",
           d."rating",
           d."homeCity",
           dos."acceptanceRate",
           dos."offersTotal" AS "offersHistorical"
    FROM "Driver" d
    JOIN "Vehicle" v ON v."id" = d."vehicleId"
    LEFT JOIN "DriverOfferStats" dos ON dos."driverId" = d."id"
    WHERE d."status" = 'ACTIVE'
      AND d."availability" = 'ONLINE'
      AND d."lastSeenAt" > NOW() - INTERVAL '2 minutes'
      AND v."category" = ${booking.vehicleCategory}::"VehicleCategory"
      AND NOT EXISTS (
        SELECT 1 FROM "DriverDocument" doc
        WHERE doc."driverId" = d."id"
          AND doc."deletedAt" IS NULL
          AND doc."type" IN ('LICENSE','RC','INSURANCE','PERMIT')
          AND (doc."verified" = false OR doc."expiresAt" IS NULL OR doc."expiresAt" <= ${booking.scheduledAt})
      )
      AND (
        SELECT COUNT(DISTINCT doc2."type") FROM "DriverDocument" doc2
        WHERE doc2."driverId" = d."id"
          AND doc2."deletedAt" IS NULL
          AND doc2."verified" = true
          AND doc2."expiresAt" > ${booking.scheduledAt}
          AND doc2."type" IN ('LICENSE','RC','INSURANCE','PERMIT')
      ) = 4
      AND NOT EXISTS (
        SELECT 1 FROM "Booking" b2
        WHERE b2."driverId" = d."id"
          AND b2."status" IN ('DRIVER_ASSIGNED','EN_ROUTE','ONGOING')
          AND tstzrange(b2."scheduledAt" - INTERVAL '2 hours',
                        b2."scheduledAt" + (b2."estimatedMin" || ' minutes')::interval + INTERVAL '2 hours')
              && tstzrange(${booking.scheduledAt} - INTERVAL '2 hours',
                           ${booking.scheduledAt} + (${booking.estimatedMin} || ' minutes')::interval + INTERVAL '2 hours')
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Offer" o
        WHERE o."driverId" = d."id" AND o."status" = 'OFFERED'
      )
      AND NOT EXISTS (
        SELECT 1 FROM "Offer" o2
        WHERE o2."bookingId" = ${booking.id} AND o2."driverId" = d."id"
          AND o2."status" IN ('DECLINED','EXPIRED')
      )
    LIMIT 50;
  `);

  return Promise.all(
    rows.map(async (r): Promise<MatchCandidate> => {
      const [lastLocation, idleMin, recentDeclineMin] = await Promise.all([
        getLocation(r.id),
        getIdleMinutes(r.id),
        getRecentDeclineMinutes(r.id),
      ]);
      return {
        driverId: r.id,
        rating: r.rating,
        homeCity: r.homeCity,
        lastLocation,
        idleMin,
        acceptanceRate: r.acceptanceRate ?? 0,
        offersHistorical: r.offersHistorical ?? 0,
        recentDeclineMin,
      };
    }),
  );
}
