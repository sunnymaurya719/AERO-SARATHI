import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { Errors } from '../../errors.js';

const RZP_BASE = 'https://api.razorpay.com/v1';

function basicAuthHeader(): string {
  const token = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  return `Basic ${token}`;
}

/** Constant-time hex/string comparison guarded against length leaks. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Verify the signature Razorpay Checkout returns to the browser handler. */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
}

/** Verify the X-Razorpay-Signature header on a webhook, over the RAW body. */
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const expected = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
  created_at: number;
}

export interface RazorpayPayment {
  id: string;
  order_id: string;
  status: string; // created | authorized | captured | refunded | failed
  method: string | null;
  amount: number;
  fee: number | null;
  tax: number | null;
  error_code?: string | null;
  error_description?: string | null;
}

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: string; // pending | processed | failed
}

async function rzpFetch<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${RZP_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error({ err, path }, 'razorpay_network_error');
    throw Errors.badGateway('Payment gateway unavailable');
  }

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    logger.error({ status: res.status, path }, 'razorpay_api_error');
    if (res.status >= 500) throw Errors.badGateway('Payment gateway error');
    const detail = (body as { error?: { description?: string } }).error?.description ?? 'Payment gateway rejected request';
    throw Errors.validation(detail);
  }
  return body as T;
}

export function createOrder(input: {
  amount: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  return rzpFetch<RazorpayOrder>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      amount: input.amount,
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: 1,
    }),
  });
}

export function fetchPayment(paymentId: string): Promise<RazorpayPayment> {
  return rzpFetch<RazorpayPayment>(`/payments/${paymentId}`, { method: 'GET' });
}

export function createRefund(input: {
  paymentId: string;
  amount: number;
  notes: Record<string, string>;
}): Promise<RazorpayRefund> {
  return rzpFetch<RazorpayRefund>(`/payments/${input.paymentId}/refund`, {
    method: 'POST',
    body: JSON.stringify({ amount: input.amount, speed: 'normal', notes: input.notes }),
  });
}

export function isRazorpayConfigured(): boolean {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}
