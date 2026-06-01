import { prisma } from '../../prisma.js';
import { Errors } from '../../errors.js';
import type { DriverTripRow } from '@aero/types';

function maskPhone(phone: string): string {
  return phone.length >= 6 ? `${phone.slice(0, 3)}****${phone.slice(-3)}` : '****';
}

const ACTIVE_STATUSES = ['DRIVER_ASSIGNED', 'EN_ROUTE', 'ONGOING'] as const;

function toRow(b: {
  id: string;
  code: string;
  status: string;
  scheduledAt: Date;
  pickupAddress: string;
  dropAddress: string;
  passengerName: string;
  passengerPhone: string;
}): DriverTripRow {
  return {
    id: b.id,
    code: b.code,
    status: b.status as DriverTripRow['status'],
    scheduledAt: b.scheduledAt.toISOString(),
    pickupAddress: b.pickupAddress,
    dropAddress: b.dropAddress,
    passengerName: b.passengerName,
    passengerPhoneMasked: maskPhone(b.passengerPhone),
  };
}

/** Trips assigned to this driver scheduled for the next 24h (the active board). */
export async function todaysTrips(driverId: string): Promise<DriverTripRow[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const rows = await prisma.booking.findMany({
    where: {
      driverId,
      status: { in: [...ACTIVE_STATUSES] },
      scheduledAt: { lte: horizon },
    },
    orderBy: { scheduledAt: 'asc' },
  });
  return rows.map(toRow);
}

export async function tripDetail(driverId: string, bookingId: string): Promise<DriverTripRow> {
  const b = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!b || b.driverId !== driverId) throw Errors.notFound('trip_not_found');
  return toRow(b);
}
