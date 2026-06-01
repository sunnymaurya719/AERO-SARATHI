import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { resolveMobileConfig } from './mobile-config.service.js';
import { env } from '../../env.js';
import { listLiveCities } from '../cities/cities.service.js';

export const mobileRouter: ExpressRouter = Router();

const ConfigQuery = z.object({
  app: z.enum(['passenger', 'driver']),
  platform: z.enum(['ANDROID', 'IOS']),
  version: z.string().min(1).max(32),
});

/**
 * Public, unauthenticated launch/resume gate. Returns the force-update +
 * maintenance verdict for this client. Called on every cold start and resume.
 */
mobileRouter.get('/config', async (req, res, next) => {
  try {
    const { app, platform, version } = ConfigQuery.parse(req.query);
    const config = await resolveMobileConfig(app, platform, version);
    res.status(200).json(config);
  } catch (err) {
    next(err);
  }
});

/**
 * Public list of bookable (LIVE) cities. Apps call this to know which regions
 * to show and to scope location pickers. Returns the default city only when
 * multi-city is disabled. (Phase 8 — Workstream B.)
 */
mobileRouter.get('/cities', async (_req, res, next) => {
  try {
    if (!env.MULTI_CITY_ENABLED) {
      res.status(200).json({ cities: [] });
      return;
    }
    res.status(200).json({ cities: await listLiveCities() });
  } catch (err) {
    next(err);
  }
});
