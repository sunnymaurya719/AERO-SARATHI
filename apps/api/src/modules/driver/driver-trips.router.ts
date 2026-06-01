import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { todaysTrips, tripDetail } from './driver-trips.service.js';
import type { DriverRequest } from './driver.middleware.js';
import { idempotency } from '../../middleware/idempotency.js';
import { placeMaskedCall } from '../calls/call-mask.service.js';
import {
  getTripRunDetail,
  startTrip,
  arrivedAtPickup,
  beginRide,
  completeRide,
  markNoShow,
  restPing,
} from '../trips/trips.service.js';

export const driverTripsRouter: ExpressRouter = Router();

driverTripsRouter.get('/today', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    res.status(200).json({ items: await todaysTrips(driver.id) });
  } catch (err) {
    next(err);
  }
});

/** REST fallback for a GPS ping (socket-less networks). */
driverTripsRouter.post('/ping', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    res.status(202).json(await restPing(driver.id, req.body));
  } catch (err) {
    next(err);
  }
});

/** Masked call: ring the passenger via the Exotel bridge. */
driverTripsRouter.post('/:id/call', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const bookingId = req.params.id!;
    res.status(200).json(await placeMaskedCall({ bookingId, fromRole: 'DRIVER', actorId: driver.id }));
  } catch (err) {
    next(err);
  }
});

const IdSchema = z.object({ id: z.string().uuid() });

// ── Phase 5 live trip lifecycle ──────────────────────────────────────────────

/** Run-screen snapshot for an in-progress trip. */
driverTripsRouter.get('/:id/run', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const { id } = IdSchema.parse(req.params);
    res.status(200).json(await getTripRunDetail(driver.id, id));
  } catch (err) {
    next(err);
  }
});

driverTripsRouter.post('/:id/start', idempotency, async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const { id } = IdSchema.parse(req.params);
    res.status(200).json(await startTrip(driver.id, id));
  } catch (err) {
    next(err);
  }
});

driverTripsRouter.post('/:id/arrived', idempotency, async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const { id } = IdSchema.parse(req.params);
    const force = req.query.force === 'true';
    res.status(200).json(await arrivedAtPickup(driver.id, id, force));
  } catch (err) {
    next(err);
  }
});

driverTripsRouter.post('/:id/begin', idempotency, async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const { id } = IdSchema.parse(req.params);
    res.status(200).json(await beginRide(driver.id, id));
  } catch (err) {
    next(err);
  }
});

const CompleteSchema = z.object({ note: z.string().max(500).optional() });

driverTripsRouter.post('/:id/complete', idempotency, async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const { id } = IdSchema.parse(req.params);
    const { note } = CompleteSchema.parse(req.body ?? {});
    res.status(200).json(await completeRide(driver.id, id, note));
  } catch (err) {
    next(err);
  }
});

driverTripsRouter.post('/:id/no-show', idempotency, async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const { id } = IdSchema.parse(req.params);
    res.status(200).json(await markNoShow(driver.id, id));
  } catch (err) {
    next(err);
  }
});

driverTripsRouter.get('/:id', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const { id } = IdSchema.parse(req.params);
    res.status(200).json(await tripDetail(driver.id, id));
  } catch (err) {
    next(err);
  }
});
