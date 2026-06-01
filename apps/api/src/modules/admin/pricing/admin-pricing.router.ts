import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import { prisma } from '../../../prisma.js';
import { createSurgeRule, createOverride, resolveSurgeForRoute } from '../../pricing/rules.service.js';

export const adminPricingRouter: ExpressRouter = Router();

const DAY_TYPES = ['WEEKDAY', 'WEEKEND', 'HOLIDAY'] as const;
const HOUR_BANDS = ['0-5', '5-8', '8-17', '17-21', '21-24'] as const;

const TimeFloorSchema = z.object({
  dayType: z.enum(DAY_TYPES),
  hourBand: z.enum(HOUR_BANDS),
  floor: z.number().min(1).max(1.8),
});

const RuleBody = z.object({
  routeBucket: z.string().min(1),
  capMultiplier: z.number().min(1).max(1.8).optional(),
  timeFloors: z.array(TimeFloorSchema).max(15),
  blackout: z.boolean().optional(),
});

const OverrideBody = z.object({
  routeBucket: z.string().min(1),
  multiplier: z.number().min(1).max(1.8),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().min(1).max(280),
});

adminPricingRouter.get('/rules', requirePermission('pricing.view'), async (_req, res, next) => {
  try {
    const rules = await prisma.surgeRule.findMany({
      where: { supersededById: null },
      orderBy: { routeBucket: 'asc' },
    });
    res.status(200).json(rules);
  } catch (err) {
    next(err);
  }
});

adminPricingRouter.post('/rules', requirePermission('pricing.manage'), async (req, res, next) => {
  try {
    const body = RuleBody.parse(req.body);
    const admin = (req as AdminRequest).admin!;
    const rule = await createSurgeRule({ ...body, createdById: admin.id });
    await audit({ req: req as AdminRequest, action: 'pricing.ruleCreate', entity: { type: 'SurgeRule', id: rule.id }, after: { routeBucket: rule.routeBucket, version: rule.version } });
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});

adminPricingRouter.get('/overrides', requirePermission('pricing.view'), async (_req, res, next) => {
  try {
    const now = new Date();
    const overrides = await prisma.surgeOverride.findMany({
      where: { endsAt: { gte: now } },
      orderBy: { startsAt: 'asc' },
    });
    res.status(200).json(overrides);
  } catch (err) {
    next(err);
  }
});

adminPricingRouter.post('/overrides', requirePermission('pricing.manage'), async (req, res, next) => {
  try {
    const body = OverrideBody.parse(req.body);
    const admin = (req as AdminRequest).admin!;
    const override = await createOverride({
      routeBucket: body.routeBucket,
      multiplier: body.multiplier,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      reason: body.reason,
      createdById: admin.id,
    });
    await audit({ req: req as AdminRequest, action: 'pricing.overrideCreate', entity: { type: 'SurgeOverride', id: override.id }, after: { routeBucket: override.routeBucket, multiplier: override.multiplier } });
    res.status(201).json(override);
  } catch (err) {
    next(err);
  }
});

const PreviewQuery = z.object({ lat: z.coerce.number(), lng: z.coerce.number() });

adminPricingRouter.get('/preview', requirePermission('pricing.view'), async (req, res, next) => {
  try {
    const { lat, lng } = PreviewQuery.parse(req.query);
    res.status(200).json(await resolveSurgeForRoute({ pickupLat: lat, pickupLng: lng }));
  } catch (err) {
    next(err);
  }
});

/** Live heatmap: current resolved surge for every route bucket that has a rule. */
adminPricingRouter.get('/heatmap', requirePermission('pricing.view'), async (_req, res, next) => {
  try {
    const rules = await prisma.surgeRule.findMany({ where: { supersededById: null }, select: { routeBucket: true } });
    const cells = await Promise.all(
      rules.map(async (r) => {
        const [latStr, lngStr] = r.routeBucket.split(':');
        const lat = Number(latStr);
        const lng = Number(lngStr);
        const resolved = await resolveSurgeForRoute({ pickupLat: lat, pickupLng: lng });
        return { routeBucket: r.routeBucket, lat, lng, multiplier: resolved.surgeMultiplier, breakdown: resolved.breakdown };
      }),
    );
    res.status(200).json({ cells });
  } catch (err) {
    next(err);
  }
});
