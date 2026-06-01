import type { Driver } from '@aero/db';
import { prisma } from '../../prisma.js';
import { Errors, AppError } from '../../errors.js';
import type { DriverMe, DriverDocStatus } from '@aero/types';
import { CRITICAL_DOC_TYPES } from '../assignment/eligibility.js';
import {
  touchHeartbeat,
  clearHeartbeat,
  setLocation,
  markIdleSince,
} from '../assignment/driver-presence.js';

const EXPIRING_SOON_DAYS = 14;

function docStatus(doc: {
  type: string;
  verified: boolean;
  expiresAt: Date | null;
}, now: Date): DriverDocStatus {
  const expired = doc.expiresAt != null && doc.expiresAt <= now;
  const expiringSoon =
    doc.expiresAt != null &&
    !expired &&
    doc.expiresAt.getTime() - now.getTime() <= EXPIRING_SOON_DAYS * 86_400_000;
  return {
    type: doc.type,
    verified: doc.verified,
    expiresAt: doc.expiresAt?.toISOString() ?? null,
    expired,
    expiringSoon,
  };
}

export async function getDriverMe(driverId: string): Promise<DriverMe> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    include: { vehicle: true, documents: { where: { deletedAt: null } }, offerStats: true },
  });
  if (!driver) throw Errors.notFound('driver_not_found');
  const now = new Date();

  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    homeCity: driver.homeCity,
    rating: driver.rating,
    availability: driver.availability,
    status: driver.status,
    acceptanceRate: driver.offerStats?.acceptanceRate ?? 0,
    vehicle: driver.vehicle
      ? {
          id: driver.vehicle.id,
          regNo: driver.vehicle.regNo,
          category: driver.vehicle.category,
          model: driver.vehicle.model,
        }
      : null,
    documents: driver.documents.map((d) => docStatus(d, now)),
  };
}

/** Reasons a driver cannot currently go ONLINE. Empty array means eligible. */
export async function onlineBlockers(driver: Driver): Promise<string[]> {
  const blockers: string[] = [];
  if (driver.status !== 'ACTIVE') blockers.push('driver_not_active');
  if (!driver.vehicleId) blockers.push('no_vehicle');

  const now = new Date();
  const docs = await prisma.driverDocument.findMany({
    where: { driverId: driver.id, deletedAt: null, type: { in: [...CRITICAL_DOC_TYPES] } },
  });
  for (const type of CRITICAL_DOC_TYPES) {
    const doc = docs.find((d) => d.type === type);
    if (!doc || !doc.verified) blockers.push(`missing_doc_${type}`);
    else if (doc.expiresAt && doc.expiresAt <= now) blockers.push(`expired_doc_${type}`);
  }
  return blockers;
}

export async function setAvailability(
  driver: Driver,
  availability: 'ONLINE' | 'OFFLINE',
): Promise<{ availability: string; blockers?: string[] }> {
  if (availability === 'ONLINE') {
    const blockers = await onlineBlockers(driver);
    if (blockers.length > 0) throw new AppError('CannotGoOnline', 403, 'cannot_go_online', blockers);
    await prisma.driver.update({
      where: { id: driver.id },
      data: { availability: 'ONLINE', lastSeenAt: new Date() },
    });
    await touchHeartbeat(driver.id);
    await markIdleSince(driver.id);
    return { availability: 'ONLINE' };
  }
  await prisma.driver.update({ where: { id: driver.id }, data: { availability: 'OFFLINE' } });
  await clearHeartbeat(driver.id);
  return { availability: 'OFFLINE' };
}

export async function heartbeat(
  driver: Driver,
  loc?: { lat: number; lng: number },
): Promise<void> {
  await prisma.driver.update({ where: { id: driver.id }, data: { lastSeenAt: new Date() } });
  await touchHeartbeat(driver.id);
  if (loc) await setLocation(driver.id, loc.lat, loc.lng);
}

export async function registerFcmToken(
  driverId: string,
  token: string,
  userAgent?: string,
  meta?: { platform?: 'ANDROID' | 'IOS'; appVersion?: string },
): Promise<void> {
  await prisma.driverFcmToken.upsert({
    where: { token },
    create: {
      driverId,
      token,
      userAgent: userAgent ?? null,
      platform: meta?.platform ?? null,
      appVersion: meta?.appVersion ?? null,
    },
    update: {
      driverId,
      lastUsedAt: new Date(),
      revokedAt: null,
      userAgent: userAgent ?? null,
      platform: meta?.platform ?? null,
      appVersion: meta?.appVersion ?? null,
    },
  });
}
