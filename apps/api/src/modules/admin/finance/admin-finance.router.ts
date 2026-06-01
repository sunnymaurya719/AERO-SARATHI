import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import { prisma } from '../../../prisma.js';
import { balanceOf, reconcile } from '../../ledger/ledger.js';
import { recordPayout } from '../../earnings/payouts.service.js';

export const adminFinanceRouter: ExpressRouter = Router();

/** Platform ledger summary across the core accounts. */
adminFinanceRouter.get('/summary', requirePermission('finance.view'), async (_req, res, next) => {
  try {
    const [platformCash, platformRevenue, promoLiability, recon] = await Promise.all([
      balanceOf('PLATFORM_CASH', null),
      balanceOf('PLATFORM_REVENUE', null),
      balanceOf('PROMO_LIABILITY', null),
      reconcile(),
    ]);
    res.status(200).json({
      platformCashPaise: platformCash.toString(),
      platformRevenuePaise: platformRevenue.toString(),
      promoLiabilityPaise: promoLiability.toString(),
      reconciliation: { debit: recon.debit.toString(), credit: recon.credit.toString(), drift: recon.drift.toString() },
    });
  } catch (err) {
    next(err);
  }
});

adminFinanceRouter.get('/payouts', requirePermission('finance.view'), async (_req, res, next) => {
  try {
    const payouts = await prisma.payout.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.status(200).json(payouts.map((p) => ({ ...p, amountPaise: p.amountPaise.toString() })));
  } catch (err) {
    next(err);
  }
});

const PayoutBody = z.object({
  driverId: z.string().min(1),
  amountPaise: z.coerce.bigint().positive(),
  method: z.string().min(1).max(40),
  reference: z.string().min(1).max(120),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});

adminFinanceRouter.post('/payouts', requirePermission('finance.payout'), async (req, res, next) => {
  try {
    const body = PayoutBody.parse(req.body);
    const admin = (req as AdminRequest).admin!;
    const result = await recordPayout({
      driverId: body.driverId,
      amountPaise: body.amountPaise,
      method: body.method,
      reference: body.reference,
      periodStart: new Date(body.periodStart),
      periodEnd: new Date(body.periodEnd),
      createdById: admin.id,
    });
    await audit({ req: req as AdminRequest, action: 'finance.payout', entity: { type: 'Payout', id: result.id }, after: { reference: body.reference, amountPaise: body.amountPaise.toString() } });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    next(err);
  }
});
