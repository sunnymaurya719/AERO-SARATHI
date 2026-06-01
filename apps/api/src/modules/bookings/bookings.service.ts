import { Prisma } from '@aero/db';
import { prisma } from '../../prisma.js';
import { Errors } from '../../errors.js';
import { env } from '../../env.js';
import { generateBookingCode } from './code.js';
import { computeCancellation } from '../cancellations/policy.js';
import { resolveCityForPoint, defaultCityId } from '../cities/cities.service.js';
import type { CreateBookingInput } from './bookings.schema.js';
import type {
  BookingResponse,
  BookingDetailResponse,
  CancellationPreview,
  CancellationSummary,
  FareOption,
  PaymentSummary,
} from '@aero/types';

function toBookingResponse(b: {
  id: string;
  code: string;
  vehicleCategory: string;
  passengerName: string;
  passengerPhone: string;
  pickupAddress: string;
  dropAddress: string;
  scheduledAt: Date;
  estimatedKm: number;
  estimatedMin: number;
  fareTotal: number;
  tokenAmount: number;
  balanceAmount: number;
  status: string;
  createdAt: Date;
}): BookingResponse {
  return {
    id: b.id,
    code: b.code,
    vehicleCategory: b.vehicleCategory as BookingResponse['vehicleCategory'],
    passengerName: b.passengerName,
    passengerPhone: b.passengerPhone,
    pickupAddress: b.pickupAddress,
    dropAddress: b.dropAddress,
    scheduledAt: b.scheduledAt.toISOString(),
    estimatedKm: b.estimatedKm,
    estimatedMin: b.estimatedMin,
    fareTotal: b.fareTotal,
    tokenAmount: b.tokenAmount,
    balanceAmount: b.balanceAmount,
    status: b.status as BookingResponse['status'],
    createdAt: b.createdAt.toISOString(),
  };
}

export async function createBooking(userId: string, input: CreateBookingInput): Promise<BookingResponse> {
  const quote = await prisma.quote.findUnique({ where: { id: input.quoteId } });
  if (!quote) throw Errors.notFound('Quote not found');
  if (quote.expiresAt.getTime() < Date.now()) throw Errors.gone('Quote expired, please request a new one');

  const fares = quote.fares as unknown as FareOption[];
  const selected = fares.find((f) => f.category === input.vehicleCategory);
  if (!selected) throw Errors.validation('Selected vehicle category not available for this quote');

  // Phase 8 — Workstream B: scope the booking to a live city by pickup point.
  // Falls back to the configured default city so single-region operation is
  // unaffected when multi-city is off (or pickup is outside drawn zones).
  let cityId: string | null = null;
  if (env.MULTI_CITY_ENABLED) {
    const hit = await resolveCityForPoint(quote.pickupLat, quote.pickupLng);
    cityId = hit?.cityId ?? (await defaultCityId());
    if (!cityId) throw Errors.validation('No serviceable city found for this pickup location');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateBookingCode();
    try {
      const booking = await prisma.$transaction(async (tx) => {
        const created = await tx.booking.create({
          data: {
            code,
            userId,
            quoteId: quote.id,
            vehicleCategory: input.vehicleCategory,
            passengerName: input.passengerName,
            passengerPhone: input.passengerPhone,
            pickupAddress: quote.pickupAddress,
            pickupLat: quote.pickupLat,
            pickupLng: quote.pickupLng,
            dropAddress: quote.dropAddress,
            dropLat: quote.dropLat,
            dropLng: quote.dropLng,
            scheduledAt: quote.scheduledAt,
            estimatedKm: quote.distanceKm,
            estimatedMin: quote.durationMin,
            fareTotal: selected.total,
            tokenAmount: selected.tokenAmount,
            balanceAmount: selected.balanceAmount,
            status: 'PENDING',
            ...(cityId ? { cityId } : {}),
          },
        });
        await tx.bookingStatusEvent.create({
          data: { bookingId: created.id, from: null, to: 'PENDING', actorId: userId },
        });
        return created;
      });
      return toBookingResponse(booking);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && attempt < 2) {
        continue; // code collision, retry
      }
      throw err;
    }
  }
  throw Errors.conflict('Could not generate a unique booking code');
}

export async function getBooking(userId: string, id: string): Promise<BookingResponse> {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking || booking.userId !== userId) throw Errors.notFound('Booking not found');
  return toBookingResponse(booking);
}

const CANCELLABLE = new Set(['PENDING', 'CONFIRMED']);

type BookingWithRelations = Prisma.BookingGetPayload<{
  include: { payments: { include: { refunds: true } }; cancellation: true };
}>;

function toBookingDetail(b: BookingWithRelations): BookingDetailResponse {
  const payments: PaymentSummary[] = b.payments
    .slice()
    .sort((a, c) => a.createdAt.getTime() - c.createdAt.getTime())
    .map((p) => ({
      id: p.id,
      type: p.type as PaymentSummary['type'],
      status: p.status as PaymentSummary['status'],
      amount: p.amount,
      amountPaid: p.amountPaid,
      method: p.gatewayMethod,
      capturedAt: p.capturedAt ? p.capturedAt.toISOString() : null,
    }));

  const tokenPaid = b.payments
    .filter((p) => p.type === 'TOKEN' && p.status === 'SUCCESS')
    .reduce((sum, p) => sum + p.amountPaid, 0);

  const canCancel = CANCELLABLE.has(b.status) && !b.cancellation;

  let cancellationPreview: CancellationPreview | null = null;
  if (canCancel) {
    const q = computeCancellation(tokenPaid, b.createdAt, b.scheduledAt);
    cancellationPreview = {
      eligible: true,
      bucket: q.bucket,
      feeAmount: q.feeAmount,
      refundAmount: q.refundAmount,
      explanation: q.explanation,
      tokenPaid,
    };
  }

  let cancellation: CancellationSummary | null = null;
  if (b.cancellation) {
    const allRefunds = b.payments.flatMap((p) => p.refunds);
    const latestRefund = allRefunds.sort((a, c) => c.createdAt.getTime() - a.createdAt.getTime())[0];
    cancellation = {
      bucket: b.cancellation.policyBucket as CancellationSummary['bucket'],
      feeAmount: b.cancellation.feeAmount,
      refundAmount: b.cancellation.refundAmount,
      refundStatus: (latestRefund?.status as CancellationSummary['refundStatus']) ?? null,
    };
  }

  return {
    ...toBookingResponse(b),
    confirmedAt: b.confirmedAt ? b.confirmedAt.toISOString() : null,
    cancelledAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    payments,
    cancellation,
    canCancel,
    cancellationPreview,
  };
}

export async function getBookingDetail(userId: string, id: string): Promise<BookingDetailResponse> {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { payments: { include: { refunds: true } }, cancellation: true },
  });
  if (!booking || booking.userId !== userId) throw Errors.notFound('Booking not found');
  return toBookingDetail(booking);
}

export async function getBookingByCode(userId: string, code: string): Promise<BookingDetailResponse> {
  const booking = await prisma.booking.findUnique({
    where: { code },
    include: { payments: { include: { refunds: true } }, cancellation: true },
  });
  if (!booking || booking.userId !== userId) throw Errors.notFound('Booking not found');
  return toBookingDetail(booking);
}

export async function listMyBookings(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<{ items: BookingResponse[]; nextCursor: string | null }> {
  const rows = await prisma.booking.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(toBookingResponse);
  return { items, nextCursor: hasMore ? (rows[limit - 1]?.id ?? null) : null };
}
