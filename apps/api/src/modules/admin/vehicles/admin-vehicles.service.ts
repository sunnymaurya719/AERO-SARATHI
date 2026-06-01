import { Prisma } from '@aero/db';
import type { VehicleCategory } from '@aero/db';
import { prisma } from '../../../prisma.js';
import { Errors } from '../../../errors.js';

export interface VehicleListFilters {
  category?: VehicleCategory;
  status?: string;
  q?: string;
  cursor?: string;
  limit: number;
}

export async function listVehicles(f: VehicleListFilters) {
  const where: Prisma.VehicleWhereInput = {};
  if (f.category) where.category = f.category;
  if (f.status) where.status = f.status as Prisma.VehicleWhereInput['status'];
  if (f.q) {
    where.OR = [
      { regNo: { contains: f.q, mode: 'insensitive' } },
      { model: { contains: f.q, mode: 'insensitive' } },
    ];
  }
  const rows = await prisma.vehicle.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
    include: { emiPlan: true, _count: { select: { drivers: true } } },
  });
  const hasMore = rows.length > f.limit;
  const items = hasMore ? rows.slice(0, f.limit) : rows;
  return { items, nextCursor: hasMore ? (rows[f.limit - 1]?.id ?? null) : null };
}

export async function getVehicle(id: string) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id }, include: { emiPlan: true, drivers: true } });
  if (!vehicle) throw Errors.notFound('Vehicle not found');
  return vehicle;
}

export interface EmiPlanInput {
  principalAmount: number;
  monthlyEmi: number;
  tenureMonths: number;
  startDate: Date;
  lender: string;
  loanRef: string;
  notes?: string;
}

export interface CreateVehicleInput {
  regNo: string;
  category: VehicleCategory;
  model: string;
  capacity: number;
  ownership: 'DRIVER' | 'COMPANY';
  emiPlan?: EmiPlanInput;
}

export async function createVehicle(input: CreateVehicleInput) {
  const existing = await prisma.vehicle.findUnique({ where: { regNo: input.regNo } });
  if (existing) throw Errors.conflict('A vehicle with this registration already exists');

  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.create({
      data: {
        regNo: input.regNo,
        category: input.category,
        model: input.model,
        capacity: input.capacity,
        ownership: input.ownership,
      },
    });
    if (input.ownership === 'COMPANY' && input.emiPlan) {
      await tx.emiPlan.create({ data: { vehicleId: vehicle.id, ...input.emiPlan } });
    }
    return tx.vehicle.findUnique({ where: { id: vehicle.id }, include: { emiPlan: true } });
  });
}

export interface UpdateVehicleInput {
  model?: string;
  capacity?: number;
  status?: 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';
  ownership?: 'DRIVER' | 'COMPANY';
}

export async function updateVehicle(id: string, input: UpdateVehicleInput) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id }, select: { id: true } });
  if (!vehicle) throw Errors.notFound('Vehicle not found');
  return prisma.vehicle.update({ where: { id }, data: input, include: { emiPlan: true } });
}

export async function upsertEmiPlan(vehicleId: string, input: EmiPlanInput) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
  if (!vehicle) throw Errors.notFound('Vehicle not found');
  return prisma.emiPlan.upsert({
    where: { vehicleId },
    create: { vehicleId, ...input },
    update: input,
  });
}

export async function deleteEmiPlan(vehicleId: string) {
  await prisma.emiPlan.deleteMany({ where: { vehicleId } });
}
