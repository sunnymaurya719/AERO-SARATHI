import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import {
  listCities,
  getCity,
  createCity,
  updateCity,
  setCityStatus,
  listZones,
  upsertZone,
  deleteZone,
} from '../../cities/cities.service.js';

export const adminCitiesRouter: ExpressRouter = Router();

const CreateCitySchema = z.object({
  code: z.string().min(2).max(8),
  name: z.string().min(1),
  timezone: z.string().min(1).optional(),
  centerLat: z.number().min(-90).max(90),
  centerLng: z.number().min(-180).max(180),
});

const UpdateCitySchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  centerLat: z.number().min(-90).max(90).optional(),
  centerLng: z.number().min(-180).max(180).optional(),
});

const StatusSchema = z.object({ status: z.enum(['PLANNED', 'LIVE', 'PAUSED']) });

// GeoJSON Polygon coordinates: ring[] of [lng, lat][]
const PolygonSchema = z.array(z.array(z.tuple([z.number(), z.number()])).min(4)).min(1);

const ZoneSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1),
  polygon: PolygonSchema,
});

adminCitiesRouter.get('/', requirePermission('cities.view'), async (_req, res, next) => {
  try {
    res.status(200).json(await listCities());
  } catch (err) {
    next(err);
  }
});

adminCitiesRouter.get('/:id', requirePermission('cities.view'), async (req, res, next) => {
  try {
    res.status(200).json(await getCity(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

adminCitiesRouter.post('/', requirePermission('cities.manage'), async (req, res, next) => {
  try {
    const input = CreateCitySchema.parse(req.body);
    const city = await createCity(input);
    await audit({ req: req as AdminRequest, action: 'city.create', entity: { type: 'City', id: city.id }, after: { code: city.code } });
    res.status(201).json(city);
  } catch (err) {
    next(err);
  }
});

adminCitiesRouter.patch('/:id', requirePermission('cities.manage'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = UpdateCitySchema.parse(req.body);
    const city = await updateCity(id, input);
    await audit({ req: req as AdminRequest, action: 'city.update', entity: { type: 'City', id }, after: input });
    res.status(200).json(city);
  } catch (err) {
    next(err);
  }
});

adminCitiesRouter.post('/:id/status', requirePermission('cities.manage'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const { status } = StatusSchema.parse(req.body);
    const city = await setCityStatus(id, status);
    await audit({ req: req as AdminRequest, action: 'city.status', entity: { type: 'City', id }, after: { status } });
    res.status(200).json(city);
  } catch (err) {
    next(err);
  }
});

adminCitiesRouter.get('/:id/zones', requirePermission('cities.view'), async (req, res, next) => {
  try {
    res.status(200).json(await listZones(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

adminCitiesRouter.put('/:id/zones', requirePermission('cities.manage'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const input = ZoneSchema.parse(req.body);
    const zone = await upsertZone(id, input as Parameters<typeof upsertZone>[1]);
    await audit({ req: req as AdminRequest, action: 'city.zone.upsert', entity: { type: 'City', id }, after: { code: input.code } });
    res.status(200).json(zone);
  } catch (err) {
    next(err);
  }
});

adminCitiesRouter.delete('/:id/zones/:zoneId', requirePermission('cities.manage'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const zoneId = String(req.params.zoneId);
    await deleteZone(id, zoneId);
    await audit({ req: req as AdminRequest, action: 'city.zone.delete', entity: { type: 'City', id }, after: { zoneId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
