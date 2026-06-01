import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { z } from 'zod';
import type { BookingStatus } from '@aero/db';
import { requirePermission } from '../../../rbac/middleware.js';
import { audit } from '../../../middleware/audit.js';
import type { AdminRequest } from '../../../middleware/admin-session.js';
import { can } from '../../../rbac/matrix.js';
import {
  listBookings,
  getAdminBookingDetail,
  assignDriver,
  unassignDriver,
  adminTransition,
  adminCancel,
  addBookingNote,
  resendNotification,
  exportBookingsCsv,
  type BookingListFilters,
} from './admin-bookings.service.js';

export const adminBookingsRouter: ExpressRouter = Router();

const BOOKING_STATUSES = [
  'PENDING', 'CONFIRMED', 'DRIVER_ASSIGNED', 'EN_ROUTE', 'ONGOING', 'COMPLETED', 'CANCELLED', 'NO_SHOW',
] as const;

function parseFilters(query: Record<string, unknown>): BookingListFilters {
  const statusRaw = typeof query.status === 'string' ? query.status : undefined;
  const status = statusRaw
    ? (statusRaw.split(',').map((s) => s.trim()).filter((s) => (BOOKING_STATUSES as readonly string[]).includes(s)) as BookingStatus[])
    : undefined;
  const limit = Math.min(Number(query.limit) || 50, 100);
  return {
    status,
    dateField: query.dateField === 'scheduled' ? 'scheduled' : 'created',
    from: query.from ? new Date(String(query.from)) : undefined,
    to: query.to ? new Date(String(query.to)) : undefined,
    q: typeof query.q === 'string' ? query.q : undefined,
    driverId: typeof query.driverId === 'string' ? query.driverId : undefined,
    vehicleCategory: typeof query.vehicleCategory === 'string' ? query.vehicleCategory : undefined,
    cursor: typeof query.cursor === 'string' ? query.cursor : undefined,
    limit,
  };
}

adminBookingsRouter.get('/', requirePermission('bookings.view'), async (req, res, next) => {
  try {
    res.status(200).json(await listBookings(parseFilters(req.query as Record<string, unknown>)));
  } catch (err) {
    next(err);
  }
});

adminBookingsRouter.get('/export.csv', requirePermission('bookings.export'), async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bookings-${Date.now()}.csv"`);
    for await (const chunk of exportBookingsCsv(parseFilters(req.query as Record<string, unknown>))) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    next(err);
  }
});

adminBookingsRouter.get('/:id', requirePermission('bookings.view'), async (req, res, next) => {
  try {
    res.status(200).json(await getAdminBookingDetail(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

const TransitionSchema = z.object({
  to: z.enum(BOOKING_STATUSES),
  reason: z.string().min(8),
});

adminBookingsRouter.post('/:id/transition', requirePermission('bookings.transition'), async (req, res, next) => {
  try {
    const { to, reason } = TransitionSchema.parse(req.body);
    const id = String(req.params.id);
    const result = await adminTransition(id, to, { actorId: (req as AdminRequest).admin!.id, reason });
    await audit({ req: req as AdminRequest, action: 'booking.transition', entity: { type: 'Booking', id }, before: result.before, after: result.after, reason });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

const AssignSchema = z.object({ driverId: z.string().min(1), reason: z.string().optional() });

adminBookingsRouter.post('/:id/assign-driver', requirePermission('bookings.assignDriver'), async (req, res, next) => {
  try {
    const { driverId, reason } = AssignSchema.parse(req.body);
    const id = String(req.params.id);
    const result = await assignDriver(id, driverId, { actorId: (req as AdminRequest).admin!.id, reason });
    await audit({ req: req as AdminRequest, action: 'booking.assignDriver', entity: { type: 'Booking', id }, before: result.before, after: result.after, reason });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

const UnassignSchema = z.object({ reason: z.string().min(8) });

adminBookingsRouter.post('/:id/unassign-driver', requirePermission('bookings.assignDriver'), async (req, res, next) => {
  try {
    const { reason } = UnassignSchema.parse(req.body);
    const id = String(req.params.id);
    const result = await unassignDriver(id, { actorId: (req as AdminRequest).admin!.id, reason });
    await audit({ req: req as AdminRequest, action: 'booking.unassignDriver', entity: { type: 'Booking', id }, before: result.before, after: result.after, reason });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

const CancelSchema = z.object({
  reason: z.string().min(8),
  refundOverride: z.number().int().nonnegative().optional(),
});

adminBookingsRouter.post('/:id/cancel', requirePermission('bookings.cancel'), async (req, res, next) => {
  try {
    const { reason, refundOverride } = CancelSchema.parse(req.body);
    const id = String(req.params.id);
    const admin = (req as AdminRequest).admin!;
    const result = await adminCancel(id, {
      actorId: admin.id,
      reason,
      refundOverride,
      canOverride: can(admin.role, 'bookings.refundOverride'),
    });
    await audit({
      req: req as AdminRequest,
      action: 'booking.cancel',
      entity: { type: 'Booking', id },
      before: { ...result.before, computed: result.computed },
      after: { ...result.after, final: result.final },
      reason,
    });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

const NoteSchema = z.object({ body: z.string().min(1).max(2000) });

adminBookingsRouter.post('/:id/notes', requirePermission('bookings.notes'), async (req, res, next) => {
  try {
    const { body } = NoteSchema.parse(req.body);
    const id = String(req.params.id);
    const note = await addBookingNote(id, (req as AdminRequest).admin!.id, body);
    await audit({ req: req as AdminRequest, action: 'booking.note', entity: { type: 'Booking', id }, after: { noteId: note.id } });
    res.status(201).json(note);
  } catch (err) {
    next(err);
  }
});

const ResendSchema = z.object({ template: z.string().min(1) });

adminBookingsRouter.post('/:id/resend-notification', requirePermission('bookings.resendNotification'), async (req, res, next) => {
  try {
    const { template } = ResendSchema.parse(req.body);
    const id = String(req.params.id);
    await resendNotification(id, template);
    await audit({ req: req as AdminRequest, action: 'booking.resendNotification', entity: { type: 'Booking', id }, after: { template } });
    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});
