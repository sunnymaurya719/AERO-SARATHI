import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { CreateBookingSchema } from './bookings.schema.js';
import { createBooking, getBookingDetail, getBookingByCode, listMyBookings } from './bookings.service.js';
import { requireAuth } from '../../middleware/auth.js';
import { idempotency } from '../../middleware/idempotency.js';
import { writeEvent } from '../../analytics/events.js';

export const bookingsRouter: ExpressRouter = Router();

bookingsRouter.post('/', requireAuth, idempotency, async (req, res, next) => {
  try {
    const input = CreateBookingSchema.parse(req.body);
    const booking = await createBooking(req.user!.id, input);
    void writeEvent('booking_created', { bookingId: booking.id, category: booking.vehicleCategory }, { userId: req.user!.id });
    res.status(201).json(booking);
  } catch (err) {
    next(err);
  }
});

bookingsRouter.get('/by-code/:code', requireAuth, async (req, res, next) => {
  try {
    const booking = await getBookingByCode(req.user!.id, String(req.params.code));
    res.status(200).json(booking);
  } catch (err) {
    next(err);
  }
});

bookingsRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const booking = await getBookingDetail(req.user!.id, String(req.params.id));
    res.status(200).json(booking);
  } catch (err) {
    next(err);
  }
});

const ListQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

bookingsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { cursor, limit } = ListQuerySchema.parse(req.query);
    const result = await listMyBookings(req.user!.id, cursor, limit);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
