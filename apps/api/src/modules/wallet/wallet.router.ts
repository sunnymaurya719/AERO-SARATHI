import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { getWalletView } from './wallet.service.js';

export const walletRouter: ExpressRouter = Router();

walletRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.status(200).json(await getWalletView(req.user!.id));
  } catch (err) {
    next(err);
  }
});
