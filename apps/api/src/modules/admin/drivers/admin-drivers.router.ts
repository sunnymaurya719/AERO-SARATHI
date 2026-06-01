import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import {
  listDrivers,
  getDriver,
  createDriver,
  updateDriver,
  assignVehicle,
  unassignVehicle,
  createDocIntent,
  createDocument,
  getDocumentUrl,
  verifyDocument,
  softDeleteDocument,
  addDriverNote,
  type DriverListFilters,
} from './admin-drivers.service.js';

export const adminDriversRouter: ExpressRouter = Router();

const DRIVER_STATUS = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'DISABLED'] as const;
const DOC_TYPES = ['LICENSE', 'RC', 'INSURANCE', 'PUC', 'PERMIT', 'AADHAAR', 'PAN', 'OTHER'] as const;

function parseFilters(q: Record<string, unknown>): DriverListFilters {
  return {
    status: typeof q.status === 'string' && (DRIVER_STATUS as readonly string[]).includes(q.status) ? (q.status as DriverListFilters['status']) : undefined,
    city: typeof q.city === 'string' ? q.city : undefined,
    q: typeof q.q === 'string' ? q.q : undefined,
    hasVehicle: q.hasVehicle === 'true' ? true : q.hasVehicle === 'false' ? false : undefined,
    docExpiringWithinDays: q.docExpiringWithinDays ? Number(q.docExpiringWithinDays) : undefined,
    cursor: typeof q.cursor === 'string' ? q.cursor : undefined,
    limit: Math.min(Number(q.limit) || 50, 100),
  };
}

adminDriversRouter.get('/', requirePermission('drivers.view'), async (req, res, next) => {
  try {
    res.status(200).json(await listDrivers(parseFilters(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

adminDriversRouter.get('/:id', requirePermission('drivers.view'), async (req, res, next) => {
  try {
    res.status(200).json(await getDriver(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

const CreateSchema = z.object({
  phone: z.string().min(10).max(15),
  name: z.string().min(2),
  licenseNo: z.string().min(4),
  homeCity: z.string().min(2),
});

adminDriversRouter.post('/', requirePermission('drivers.edit'), async (req, res, next) => {
  try {
    const input = CreateSchema.parse(req.body);
    const driver = await createDriver({ ...input, createdById: (req as AdminRequest).admin!.id });
    await audit({ req: req as AdminRequest, action: 'driver.create', entity: { type: 'Driver', id: driver.id }, after: { phone: driver.phone, name: driver.name } });
    res.status(201).json(driver);
  } catch (err) {
    next(err);
  }
});

const UpdateSchema = z.object({
  name: z.string().min(2).optional(),
  homeCity: z.string().min(2).optional(),
  status: z.enum(DRIVER_STATUS).optional(),
  rating: z.number().min(0).max(5).optional(),
});

adminDriversRouter.patch('/:id', requirePermission('drivers.edit'), async (req, res, next) => {
  try {
    const input = UpdateSchema.parse(req.body);
    // Rating change is ADMIN+ only.
    if (input.rating !== undefined) {
      const role = (req as AdminRequest).admin!.role;
      if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') return next();
    }
    const id = String(req.params.id);
    const driver = await updateDriver(id, input);
    await audit({ req: req as AdminRequest, action: 'driver.update', entity: { type: 'Driver', id }, after: input });
    res.status(200).json(driver);
  } catch (err) {
    next(err);
  }
});

const VehicleSchema = z.object({ vehicleId: z.string().min(1) });

adminDriversRouter.post('/:id/vehicle', requirePermission('drivers.edit'), async (req, res, next) => {
  try {
    const { vehicleId } = VehicleSchema.parse(req.body);
    const id = String(req.params.id);
    const driver = await assignVehicle(id, vehicleId);
    await audit({ req: req as AdminRequest, action: 'driver.assignVehicle', entity: { type: 'Driver', id }, after: { vehicleId } });
    res.status(200).json(driver);
  } catch (err) {
    next(err);
  }
});

adminDriversRouter.delete('/:id/vehicle', requirePermission('drivers.edit'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const driver = await unassignVehicle(id);
    await audit({ req: req as AdminRequest, action: 'driver.unassignVehicle', entity: { type: 'Driver', id } });
    res.status(200).json(driver);
  } catch (err) {
    next(err);
  }
});

const IntentSchema = z.object({
  type: z.enum(DOC_TYPES),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

adminDriversRouter.post('/:id/documents/intent', requirePermission('drivers.docs'), async (req, res, next) => {
  try {
    const input = IntentSchema.parse(req.body);
    const result = await createDocIntent(String(req.params.id), input);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

const MetadataSchema = z.object({
  type: z.enum(DOC_TYPES),
  fileKey: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  issuedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

adminDriversRouter.post('/:id/documents', requirePermission('drivers.docs'), async (req, res, next) => {
  try {
    const input = MetadataSchema.parse(req.body);
    const id = String(req.params.id);
    const doc = await createDocument(id, {
      ...input,
      issuedAt: input.issuedAt ? new Date(input.issuedAt) : undefined,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      uploadedById: (req as AdminRequest).admin!.id,
    });
    await audit({ req: req as AdminRequest, action: 'driver.document.create', entity: { type: 'Driver', id }, after: { docId: doc.id, type: doc.type } });
    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

adminDriversRouter.get('/:id/documents/:docId/url', requirePermission('drivers.view'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const docId = String(req.params.docId);
    const url = await getDocumentUrl(id, docId);
    // Downloads are audit-logged (Phase 3 §6.4).
    await audit({ req: req as AdminRequest, action: 'driver.document.download', entity: { type: 'Driver', id }, after: { docId } });
    res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
});

adminDriversRouter.post('/:id/documents/:docId/verify', requirePermission('drivers.docs'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const docId = String(req.params.docId);
    const doc = await verifyDocument(id, docId, (req as AdminRequest).admin!.id);
    await audit({ req: req as AdminRequest, action: 'driver.document.verify', entity: { type: 'Driver', id }, after: { docId } });
    res.status(200).json(doc);
  } catch (err) {
    next(err);
  }
});

adminDriversRouter.delete('/:id/documents/:docId', requirePermission('drivers.delete'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const docId = String(req.params.docId);
    const doc = await softDeleteDocument(id, docId);
    await audit({ req: req as AdminRequest, action: 'driver.document.delete', entity: { type: 'Driver', id }, after: { docId } });
    res.status(200).json(doc);
  } catch (err) {
    next(err);
  }
});

const NoteSchema = z.object({ body: z.string().min(1).max(2000) });

adminDriversRouter.post('/:id/notes', requirePermission('drivers.edit'), async (req, res, next) => {
  try {
    const { body } = NoteSchema.parse(req.body);
    const id = String(req.params.id);
    const note = await addDriverNote(id, (req as AdminRequest).admin!.id, body);
    await audit({ req: req as AdminRequest, action: 'driver.note', entity: { type: 'Driver', id }, after: { noteId: note.id } });
    res.status(201).json(note);
  } catch (err) {
    next(err);
  }
});
