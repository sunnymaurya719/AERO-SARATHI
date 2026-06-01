import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { Errors } from '../../errors.js';
import { prisma } from '../../prisma.js';
import { writeEvent } from '../../analytics/events.js';
import { submitReview } from './review.service.js';

export const reviewRouter: ExpressRouter = Router();

const SubmitBody = z.object({
  bookingId: z.string().min(1),
  stars: z.number().int().min(1).max(5),
  tags: z.array(z.string().max(40)).max(10).optional(),
  text: z.string().max(1000).optional(),
});

/** Customer rates the driver for a completed booking. */
reviewRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const body = SubmitBody.parse(req.body);
    const userId = req.user!.id;
    const booking = await prisma.booking.findUnique({
      where: { id: body.bookingId },
      select: { userId: true, driverId: true },
    });
    if (!booking || booking.userId !== userId) throw Errors.notFound('booking_not_found');
    if (!booking.driverId) throw Errors.validation('no_driver_assigned');

    const review = await submitReview({
      bookingId: body.bookingId,
      direction: 'CUSTOMER_TO_DRIVER',
      raterId: userId,
      rateeId: booking.driverId,
      stars: body.stars,
      tags: body.tags,
      text: body.text,
    });
    void writeEvent('review_submitted', { bookingId: body.bookingId, stars: body.stars, direction: 'CUSTOMER_TO_DRIVER' }, { userId });
    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
});
