import type {
  QuoteRequest,
  QuoteResponse,
  OtpRequestResponse,
  AuthTokenResponse,
  CreateBookingRequest,
  BookingResponse,
  BookingDetailResponse,
  PaymentIntentResponse,
  PaymentVerifyRequest,
  PaymentVerifyResponse,
  CancellationPreview,
  CancellationSummary,
  ProblemDetails,
} from '@aero/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export const API_BASE_URL = API_URL;

export class ApiError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  token?: string | null;
  idempotencyKey?: string;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  if (res.status === 204) return undefined as T;

  const data = await res.json();
  if (!res.ok) throw new ApiError(data as ProblemDetails);
  return data as T;
}

export const api = {
  createQuote: (input: QuoteRequest) => request<QuoteResponse>('POST', '/quotes', input),
  requestOtp: (phone: string) => request<OtpRequestResponse>('POST', '/auth/otp/request', { phone }),
  verifyOtp: (phone: string, code: string) => request<AuthTokenResponse>('POST', '/auth/otp/verify', { phone, code }),
  createBooking: (input: CreateBookingRequest, token: string, idempotencyKey: string) =>
    request<BookingResponse>('POST', '/bookings', input, { token, idempotencyKey }),
  getBooking: (id: string, token: string) =>
    request<BookingDetailResponse>('GET', `/bookings/${id}`, undefined, { token }),
  getBookingByCode: (code: string, token: string) =>
    request<BookingDetailResponse>('GET', `/bookings/by-code/${code}`, undefined, { token }),
  listBookings: (token: string) =>
    request<{ items: BookingResponse[]; nextCursor: string | null }>('GET', '/bookings', undefined, { token }),

  // Phase 2 — payments
  createPaymentIntent: (bookingId: string, token: string, idempotencyKey: string) =>
    request<PaymentIntentResponse>('POST', `/bookings/${bookingId}/payment/intent`, {}, { token, idempotencyKey }),
  verifyPayment: (bookingId: string, body: PaymentVerifyRequest, token: string, idempotencyKey: string) =>
    request<PaymentVerifyResponse>('POST', `/bookings/${bookingId}/payment/verify`, body, { token, idempotencyKey }),

  // Phase 2 — cancellation
  cancelPreview: (bookingId: string, token: string) =>
    request<CancellationPreview>('GET', `/bookings/${bookingId}/cancel/preview`, undefined, { token }),
  cancelBooking: (bookingId: string, reason: string, token: string, idempotencyKey: string) =>
    request<CancellationSummary>('POST', `/bookings/${bookingId}/cancel`, { reason, confirm: true }, { token, idempotencyKey }),

  receiptUrl: (bookingId: string) => `${API_URL}/bookings/${bookingId}/receipt`,
};
