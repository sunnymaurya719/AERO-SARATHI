import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import {
  listVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  upsertEmiPlan,
  deleteEmiPlan,
  type VehicleListFilters,
} from './admin-vehicles.service.js';

export const adminVehiclesRouter: ExpressRouter = Router();

const CATEGORIES = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'] as const;
const STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED'] as const;

function parseFilters(q: Record<string, unknown>): VehicleListFilters {
  return {
    category: typeof q.category === 'string' && (CATEGORIES as readonly string[]).includes(q.category) ? (q.category as VehicleListFilters['category']) : undefined,
    status: typeof q.status === 'string' && (STATUSES as readonly string[]).includes(q.status) ? q.status : undefined,
    q: typeof q.q === 'string' ? q.q : undefined,
    cursor: typeof q.cursor === 'string' ? q.cursor : undefined,
    limit: Math.min(Number(q.limit) || 50, 100),
  };
}

const EmiSchema = z.object({
  principalAmount: z.number().int().positive(),
  monthlyEmi: z.number().int().positive(),
  tenureMonths: z.number().int().positive(),
  startDate: z.string().datetime(),
  lender: z.string().min(1),
  loanRef: z.string().min(1),
  notes: z.string().optional(),
});

adminVehiclesRouter.get('/', requirePermission('vehicles.view'), async (req, res, next) => {
  try {
    res.status(200).json(await listVehicles(parseFilters(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

adminVehiclesRouter.get('/:id', requirePermission('vehicles.view'), async (req, res, next) => {
  try {
    res.status(200).json(await getVehicle(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

const CreateSchema = z.object({
  regNo: z.string().min(4),
  category: z.enum(CATEGORIES),
  model: z.string().min(1),
  capacity: z.number().int().positive(),
  ownership: z.enum(['DRIVER', 'COMPANY']),
  emiPlan: EmiSchema.optional(),
});

adminVehiclesRouter.post('/', requirePermission('vehicles.edit'), async (req, res, next) => {
  try {
    const input = CreateSchema.parse(req.body);
    const vehicle = await createVehicle({
      ...input,
      emiPlan: input.emiPlan ? { ...input.emiPlan, startDate: new Date(input.emiPlan.startDate) } : undefined,
    });
    await audit({ req: req as AdminRequest, action: 'vehicle.create', entity: { type: 'Vehicle', id: vehicle!.id }, after: { regNo: vehicle!.regNo } });
    res.status(201).json(vehicle);
  } catch (err) {
    next(err);
  }
});

const UpdateSchema = z.object({
  model: z.string().min(1).optional(),
  capacity: z.number().int().positive().optional(),
  status: z.enum(STATUSES).optional(),
  ownership: z.enum(['DRIVER', 'COMPANY']).optional(),
});

adminVehiclesRouter.patch('/:id', requirePermission('vehicles.edit'), async (req, res, next) => {
  try {
    const input = UpdateSchema.parse(req.body);
    const id = String(req.params.id);
    const vehicle = await updateVehicle(id, input);
    await audit({ req: req as AdminRequest, action: 'vehicle.update', entity: { type: 'Vehicle', id }, after: input });
    res.status(200).json(vehicle);
  } catch (err) {
    next(err);
  }
});

adminVehiclesRouter.put('/:id/emi-plan', requirePermission('vehicles.edit'), async (req, res, next) => {
  try {
    const input = EmiSchema.parse(req.body);
    const id = String(req.params.id);
    const plan = await upsertEmiPlan(id, { ...input, startDate: new Date(input.startDate) });
    await audit({ req: req as AdminRequest, action: 'vehicle.emiPlan.upsert', entity: { type: 'Vehicle', id } });
    res.status(200).json(plan);
  } catch (err) {
    next(err);
  }
});

adminVehiclesRouter.delete('/:id/emi-plan', requirePermission('vehicles.edit'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    await deleteEmiPlan(id);
    await audit({ req: req as AdminRequest, action: 'vehicle.emiPlan.delete', entity: { type: 'Vehicle', id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
