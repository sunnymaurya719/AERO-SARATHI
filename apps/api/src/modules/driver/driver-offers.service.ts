import { prisma } from '../../prisma.js';
import type { DriverOfferView } from '@aero/types';

/** All currently-open offers for a driver (usually 0 or 1). */
export async function activeOffers(driverId: string): Promise<DriverOfferView[]> {
  const offers = await prisma.offer.findMany({
    where: { driverId, status: 'OFFERED', expiresAt: { gt: new Date() } },
    include: { booking: true },
    orderBy: { offeredAt: 'desc' },
  });

  return offers.map((o) => ({
    id: o.id,
    bookingCode: o.booking.code,
    status: o.status,
    offeredAt: o.offeredAt.toISOString(),
    expiresAt: o.expiresAt.toISOString(),
    pickupAddress: o.booking.pickupAddress,
    dropAddress: o.booking.dropAddress,
    scheduledAt: o.booking.scheduledAt.toISOString(),
    estimatedKm: o.booking.estimatedKm,
    estimatedMin: o.booking.estimatedMin,
    fareToDriver: o.booking.balanceAmount,
  }));
}
