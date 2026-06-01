import { randomUUID } from 'node:crypto';
import { Prisma } from '@aero/db';
import type { DriverStatus, DocType } from '@aero/db';
import { prisma } from '../../../prisma.js';
import { Errors } from '../../../errors.js';
import { presignPut, presignGet, buildDocKey, isAllowedDocMime, MAX_DOC_BYTES } from '../../../integrations/s3.js';

export interface DriverListFilters {
  status?: DriverStatus;
  city?: string;
  q?: string;
  hasVehicle?: boolean;
  docExpiringWithinDays?: number;
  cursor?: string;
  limit: number;
}

export async function listDrivers(f: DriverListFilters) {
  const where: Prisma.DriverWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.city) where.homeCity = { contains: f.city, mode: 'insensitive' };
  if (f.hasVehicle === true) where.vehicleId = { not: null };
  if (f.hasVehicle === false) where.vehicleId = null;
  if (f.q) {
    where.OR = [
      { name: { contains: f.q, mode: 'insensitive' } },
      { phone: { contains: f.q } },
      { licenseNo: { contains: f.q, mode: 'insensitive' } },
    ];
  }
  if (f.docExpiringWithinDays !== undefined) {
    const cutoff = new Date(Date.now() + f.docExpiringWithinDays * 24 * 60 * 60 * 1000);
    where.documents = { some: { deletedAt: null, expiresAt: { lte: cutoff, gte: new Date() } } };
  }

  const rows = await prisma.driver.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { vehicle: { select: { id: true, regNo: true, category: true } } },
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? (rows[f.limit - 1]?.id ?? null) : null };
}

export async function getDriver(id: string) {
  const driver = await prisma.driver.findUnique({
    where: { id },
    include: {
      vehicle: true,
      documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } },
      notes: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!driver) throw Errors.notFound('Driver not found');
  return driver;
}

export interface CreateDriverInput {
  phone: string;
  name: string;
  licenseNo: string;
  homeCity: string;
  createdById: string;
}

export async function createDriver(input: CreateDriverInput) {
  const existing = await prisma.driver.findUnique({ where: { phone: input.phone } });
  if (existing) throw Errors.conflict('A driver with this phone already exists');

  // Create the User (role DRIVER, no password) + Driver row in one transaction.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { phone: input.phone },
      update: { role: 'DRIVER', name: input.name },
      create: { phone: input.phone, name: input.name, role: 'DRIVER' },
    });
    return tx.driver.create({
      data: {
        userId: user.id,
        phone: input.phone,
        name: input.name,
        licenseNo: input.licenseNo,
        homeCity: input.homeCity,
        status: 'ONBOARDING',
        createdById: input.createdById,
      },
    });
  });
}

export interface UpdateDriverInput {
  name?: string;
  homeCity?: string;
  status?: DriverStatus;
  rating?: number;
}

export async function updateDriver(id: string, input: UpdateDriverInput) {
  const driver = await prisma.driver.findUnique({ where: { id }, select: { id: true } });
  if (!driver) throw Errors.notFound('Driver not found');
  return prisma.driver.update({ where: { id }, data: input });
}

export async function assignVehicle(driverId: string, vehicleId: string) {
  const [driver, vehicle] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } }),
    prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, status: true } }),
  ]);
  if (!driver) throw Errors.notFound('Driver not found');
  if (!vehicle) throw Errors.notFound('Vehicle not found');
  if (vehicle.status !== 'ACTIVE') throw Errors.conflict('Vehicle is not ACTIVE');
  return prisma.driver.update({ where: { id: driverId }, data: { vehicleId } });
}

export async function unassignVehicle(driverId: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } });
  if (!driver) throw Errors.notFound('Driver not found');
  return prisma.driver.update({ where: { id: driverId }, data: { vehicleId: null } });
}

export interface DocIntentInput {
  type: DocType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** Step 1 of upload: validate + return a presigned PUT URL and the fileKey. */
export async function createDocIntent(driverId: string, input: DocIntentInput) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } });
  if (!driver) throw Errors.notFound('Driver not found');
  if (!isAllowedDocMime(input.mimeType)) throw Errors.validation('Unsupported file type');
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_DOC_BYTES) throw Errors.validation('File exceeds 10 MB limit');

  const fileKey = buildDocKey(driverId, input.type, randomUUID(), input.fileName);
  const uploadUrl = await presignPut(fileKey, input.mimeType, input.sizeBytes);
  return { fileKey, uploadUrl };
}

export interface DocMetadataInput {
  type: DocType;
  fileKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  issuedAt?: Date;
  expiresAt?: Date;
  uploadedById: string;
}

/** Step 3 of upload: persist the document metadata after the S3 PUT succeeds. */
export async function createDocument(driverId: string, input: DocMetadataInput) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } });
  if (!driver) throw Errors.notFound('Driver not found');
  if (!isAllowedDocMime(input.mimeType)) throw Errors.validation('Unsupported file type');
  if (!input.fileKey.startsWith(`drivers/${driverId}/`)) throw Errors.validation('fileKey does not match driver');

  return prisma.driverDocument.create({
    data: {
      driverId,
      type: input.type,
      fileKey: input.fileKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      uploadedById: input.uploadedById,
    },
  });
}

export async function getDocumentUrl(driverId: string, docId: string): Promise<string> {
  const doc = await prisma.driverDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.driverId !== driverId || doc.deletedAt) throw Errors.notFound('Document not found');
  return presignGet(doc.fileKey);
}

export async function verifyDocument(driverId: string, docId: string, verifiedById: string) {
  const doc = await prisma.driverDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.driverId !== driverId || doc.deletedAt) throw Errors.notFound('Document not found');
  return prisma.driverDocument.update({
    where: { id: docId },
    data: { verified: true, verifiedById, verifiedAt: new Date() },
  });
}

export async function softDeleteDocument(driverId: string, docId: string) {
  const doc = await prisma.driverDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.driverId !== driverId || doc.deletedAt) throw Errors.notFound('Document not found');
  return prisma.driverDocument.update({ where: { id: docId }, data: { deletedAt: new Date() } });
}

export async function addDriverNote(driverId: string, authorId: string, body: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { id: true } });
  if (!driver) throw Errors.notFound('Driver not found');
  return prisma.driverNote.create({ data: { driverId, authorId, body } });
}
