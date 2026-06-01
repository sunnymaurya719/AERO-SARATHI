import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import {
  listFareRules,
  listActiveFareRules,
  createFareRule,
  previewFare,
} from './admin-fare-rules.service.js';

export const adminFareRulesRouter: ExpressRouter = Router();

const CATEGORIES = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'] as const;

adminFareRulesRouter.get('/', requirePermission('fareRules.view'), async (req, res, next) => {
  try {
    const category = typeof req.query.category === 'string' && (CATEGORIES as readonly string[]).includes(req.query.category)
      ? (req.query.category as (typeof CATEGORIES)[number])
      : undefined;
    res.status(200).json(await listFareRules(category));
  } catch (err) {
    next(err);
  }
});

adminFareRulesRouter.get('/active', requirePermission('fareRules.view'), async (_req, res, next) => {
  try {
    res.status(200).json(await listActiveFareRules());
  } catch (err) {
    next(err);
  }
});

const RuleBody = z.object({
  baseFare: z.number().int().nonnegative(),
  baseKm: z.number().int().nonnegative(),
  perKm: z.number().int().nonnegative(),
  perMin: z.number().int().nonnegative(),
  nightSurcharge: z.number().min(0).max(2),
  minFare: z.number().int().nonnegative(),
  tokenPercent: z.number().min(0).max(1),
});

const PreviewSchema = z.object({
  category: z.enum(CATEGORIES),
  distanceKm: z.number().positive(),
  durationMin: z.number().positive(),
  scheduledAt: z.string().datetime(),
  rule: RuleBody.optional(),
});

adminFareRulesRouter.post('/preview', requirePermission('fareRules.view'), async (req, res, next) => {
  try {
    const input = PreviewSchema.parse(req.body);
    const result = await previewFare({ ...input, scheduledAt: new Date(input.scheduledAt) });
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

const CreateSchema = RuleBody.extend({
  category: z.enum(CATEGORIES),
  effectiveFrom: z.string().datetime(),
  notes: z.string().optional(),
});

adminFareRulesRouter.post('/', requirePermission('fareRules.edit'), async (req, res, next) => {
  try {
    const input = CreateSchema.parse(req.body);
    const rule = await createFareRule({
      ...input,
      effectiveFrom: new Date(input.effectiveFrom),
      createdById: (req as AdminRequest).admin!.id,
    });
    await audit({ req: req as AdminRequest, action: 'fareRule.create', entity: { type: 'FareRule', id: rule.id, code: rule.category }, after: { category: rule.category, effectiveFrom: rule.effectiveFrom } });
    res.status(201).json(rule);
  } catch (err) {
    next(err);
  }
});
