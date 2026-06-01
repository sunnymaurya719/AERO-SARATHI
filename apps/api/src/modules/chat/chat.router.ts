import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import {
  assertCanRead,
  assertCanSend,
  listMessages,
  markRead,
  saveMessage,
} from './chat.service.js';
import { fanoutChat } from '../../realtime/io.js';
import { sendOfferPush } from '../../integrations/fcm.js';

/** Passenger-facing chat history + REST send fallback. Mounted at /api/v1/bookings. */
export const chatRouter: ExpressRouter = Router();

chatRouter.get('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    if (!env.CHAT_ENABLED) throw Errors.forbidden('Chat disabled');
    const bookingId = req.params.id!;
    await assertCanRead(bookingId, 'PASSENGER', req.user!.id);
    res.status(200).json({ messages: await listMessages(bookingId) });
  } catch (err) {
    next(err);
  }
});

const SendSchema = z.object({ text: z.string().trim().min(1).max(env.CHAT_MAX_LEN) });

chatRouter.post('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    if (!env.CHAT_ENABLED) throw Errors.forbidden('Chat disabled');
    const bookingId = req.params.id!;
    const { text } = SendSchema.parse(req.body);
    const { booking } = await assertCanSend(bookingId, 'PASSENGER', req.user!.id);
    const msg = await saveMessage({ bookingId, fromRole: 'PASSENGER', fromId: req.user!.id, text });
    fanoutChat(bookingId, booking.driverId, msg);
    if (booking.driverId) {
      void sendOfferPush(booking.driverId, { type: 'chat', code: bookingId, deepLink: `aerosarathi://bookings/${bookingId}` });
    }
    res.status(201).json(msg);
  } catch (err) {
    next(err);
  }
});

chatRouter.post('/:id/messages/read', requireAuth, async (req, res, next) => {
  try {
    const bookingId = req.params.id!;
    await assertCanRead(bookingId, 'PASSENGER', req.user!.id);
    await markRead(bookingId, 'PASSENGER');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
