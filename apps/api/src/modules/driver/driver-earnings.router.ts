import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import type { DriverRequest } from './driver.middleware.js';
import { buildDriverStatement } from '../earnings/earnings.service.js';
import { payableBalance } from '../earnings/payouts.service.js';
import { getDriverEmi } from '../emi/emi.service.js';

export const driverEarningsRouter: ExpressRouter = Router();

/** Current payable balance + this week's statement. */
driverEarningsRouter.get('/earnings', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setUTCDate(now.getUTCDate() - 7);
    const [statement, payable] = await Promise.all([
      buildDriverStatement(driver.id, weekStart, now),
      payableBalance(driver.id),
    ]);
    res.status(200).json({ payableBalancePaise: payable.toString(), statement });
  } catch (err) {
    next(err);
  }
});

driverEarningsRouter.get('/emi', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    res.status(200).json((await getDriverEmi(driver.id)) ?? { plan: null });
  } catch (err) {
    next(err);
  }
});
