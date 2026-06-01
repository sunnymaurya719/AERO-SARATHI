import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { DriverRequest } from './driver.middleware.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import {
  assertCanRead,
  assertCanSend,
  listMessages,
  markRead,
  saveMessage,
} from '../chat/chat.service.js';
import { fanoutChat } from '../../realtime/io.js';
import { sendCustomerPush } from '../../integrations/fcm.js';

/** Driver-facing chat history + REST send fallback. Mounted under the driver router. */
export const driverChatRouter: ExpressRouter = Router();

driverChatRouter.get('/trips/:id/messages', async (req, res, next) => {
  try {
    if (!env.CHAT_ENABLED) throw Errors.forbidden('Chat disabled');
    const driver = (req as DriverRequest).driver!;
    const bookingId = req.params.id!;
    await assertCanRead(bookingId, 'DRIVER', driver.id);
    res.status(200).json({ messages: await listMessages(bookingId) });
  } catch (err) {
    next(err);
  }
});

const SendSchema = z.object({ text: z.string().trim().min(1).max(env.CHAT_MAX_LEN) });

driverChatRouter.post('/trips/:id/messages', async (req, res, next) => {
  try {
    if (!env.CHAT_ENABLED) throw Errors.forbidden('Chat disabled');
    const driver = (req as DriverRequest).driver!;
    const bookingId = req.params.id!;
    const { text } = SendSchema.parse(req.body);
    const { booking, toUserId } = await assertCanSend(bookingId, 'DRIVER', driver.id);
    const msg = await saveMessage({ bookingId, fromRole: 'DRIVER', fromId: driver.id, text });
    fanoutChat(bookingId, booking.driverId, msg);
    if (toUserId) {
      void sendCustomerPush(toUserId, { title: 'New message from your driver', body: msg.text.slice(0, 120) }, {
        type: 'chat',
        bookingId,
      });
    }
    res.status(201).json(msg);
  } catch (err) {
    next(err);
  }
});

driverChatRouter.post('/trips/:id/messages/read', async (req, res, next) => {
  try {
    const driver = (req as DriverRequest).driver!;
    const bookingId = req.params.id!;
    await assertCanRead(bookingId, 'DRIVER', driver.id);
    await markRead(bookingId, 'DRIVER');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
