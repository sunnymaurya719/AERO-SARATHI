import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { ipRateLimit } from '../../middleware/rate-limit.js';
import type { DriverRequest } from './driver.middleware.js';
import {
  getDriverMe,
  setAvailability,
  heartbeat,
  registerFcmToken,
} from './driver-me.service.js';

export const driverMeRouter: ExpressRouter = Router();

driverMeRouter.get('/me', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    res.status(200).json(await getDriverMe(driver.id));
  } catch (err) {
    next(err);
  }
});

const AvailabilitySchema = z.object({ availability: z.enum(['ONLINE', 'OFFLINE']) });

driverMeRouter.patch(
  '/me/availability',
  ipRateLimit({ keyPrefix: 'rl:drv:avail', points: 30, durationSec: 60 }),
  async (req, res, next) => {
    try {
      const driver = (req as DriverRequest).driver!;
      const { availability } = AvailabilitySchema.parse(req.body);
      res.status(200).json(await setAvailability(driver, availability));
    } catch (err) {
      next(err);
    }
  },
);

const HeartbeatSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

driverMeRouter.post(
  '/me/heartbeat',
  ipRateLimit({ keyPrefix: 'rl:drv:hb', points: 4, durationSec: 60 }),
  async (req, res, next) => {
    try {
      const driver = (req as DriverRequest).driver!;
      const body = HeartbeatSchema.parse(req.body ?? {});
      const loc = body.lat != null && body.lng != null ? { lat: body.lat, lng: body.lng } : undefined;
      await heartbeat(driver, loc);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

const FcmSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(['ANDROID', 'IOS']).optional(),
  appVersion: z.string().max(32).optional(),
});

driverMeRouter.post('/me/fcm-token', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const { token, platform, appVersion } = FcmSchema.parse(req.body);
    await registerFcmToken(driver.id, token, req.header('user-agent') ?? undefined, { platform, appVersion });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
