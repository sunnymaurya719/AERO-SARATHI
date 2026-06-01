import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { env } from '../src/env.js';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../src/modules/payments/razorpay.js';

describe('verifyCheckoutSignature', () => {
  const orderId = 'order_ABC123';
  const paymentId = 'pay_XYZ789';
  const valid = createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  it('accepts a correctly computed signature', () => {
    expect(verifyCheckoutSignature(orderId, paymentId, valid)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    expect(verifyCheckoutSignature(orderId, paymentId, valid.replace(/.$/, '0'))).toBe(false);
  });

  it('rejects a signature for a different payment', () => {
    expect(verifyCheckoutSignature(orderId, 'pay_OTHER', valid)).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verifyCheckoutSignature(orderId, paymentId, '')).toBe(false);
  });
});

describe('verifyWebhookSignature', () => {
  const body = Buffer.from(JSON.stringify({ event: 'payment.captured', id: 'evt_1' }));
  const valid = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');

  it('accepts a signature over the exact raw body', () => {
    expect(verifyWebhookSignature(body, valid)).toBe(true);
  });

  it('rejects when the body is mutated', () => {
    const tampered = Buffer.from(JSON.stringify({ event: 'payment.captured', id: 'evt_2' }));
    expect(verifyWebhookSignature(tampered, valid)).toBe(false);
  });

  it('rejects a garbage signature', () => {
    expect(verifyWebhookSignature(body, 'deadbeef')).toBe(false);
  });
});
