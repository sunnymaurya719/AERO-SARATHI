import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import { prisma } from '../../../prisma.js';
import { activateEmiPlan, recordManualCollection, getDriverEmi } from '../../emi/emi.service.js';

export const adminEmiRouter: ExpressRouter = Router();

adminEmiRouter.get('/', requirePermission('emi.view'), async (_req, res, next) => {
  try {
    const plans = await prisma.emiPlan.findMany({ where: { driverId: { not: null } }, orderBy: { activatedAt: 'desc' }, take: 200 });
    res.status(200).json(
      plans.map((p) => ({
        ...p,
        perTripCutPaise: p.perTripCutPaise?.toString() ?? null,
        totalDuePaise: p.totalDuePaise?.toString() ?? null,
        weeklyTargetPaise: p.weeklyTargetPaise?.toString() ?? null,
        collectedPaise: p.collectedPaise.toString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

adminEmiRouter.get('/driver/:driverId', requirePermission('emi.view'), async (req, res, next) => {
  try {
    res.status(200).json((await getDriverEmi(String(req.params.driverId))) ?? { plan: null });
  } catch (err) {
    next(err);
  }
});

const ActivateBody = z.object({
  emiPlanId: z.string().min(1),
  driverId: z.string().min(1),
  perTripCutPaise: z.coerce.bigint().positive(),
  totalDuePaise: z.coerce.bigint().positive(),
  weeklyTargetPaise: z.coerce.bigint().positive().optional(),
});

adminEmiRouter.post('/activate', requirePermission('emi.manage'), async (req, res, next) => {
  try {
    const body = ActivateBody.parse(req.body);
    await activateEmiPlan({
      emiPlanId: body.emiPlanId,
      driverId: body.driverId,
      perTripCutPaise: body.perTripCutPaise,
      totalDuePaise: body.totalDuePaise,
      weeklyTargetPaise: body.weeklyTargetPaise ?? null,
    });
    await audit({ req: req as AdminRequest, action: 'emi.activate', entity: { type: 'EmiPlan', id: body.emiPlanId }, after: { driverId: body.driverId } });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

const CollectBody = z.object({
  emiPlanId: z.string().min(1),
  amountPaise: z.coerce.bigint().positive(),
  source: z.enum(['MANUAL', 'ADJUSTMENT']),
});

adminEmiRouter.post('/collect', requirePermission('emi.manage'), async (req, res, next) => {
  try {
    const body = CollectBody.parse(req.body);
    await recordManualCollection({ emiPlanId: body.emiPlanId, amountPaise: body.amountPaise, source: body.source });
    await audit({ req: req as AdminRequest, action: 'emi.collect', entity: { type: 'EmiPlan', id: body.emiPlanId }, after: { amountPaise: body.amountPaise.toString(), source: body.source } });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
