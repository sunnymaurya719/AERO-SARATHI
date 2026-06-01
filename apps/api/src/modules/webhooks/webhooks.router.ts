import { Router, raw } from 'express';
import type { Router as ExpressRouter } from 'express';
import { Prisma } from '@aero/db';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { verifyWebhookSignature } from '../payments/razorpay.js';
import { webhookQueue } from '../../queues/index.js';
import { env } from '../../env.js';
import { recordCallStatus } from '../calls/call-mask.service.js';

export const webhooksRouter: ExpressRouter = Router();

/**
 * Razorpay webhook receiver. MUST read the raw body (no JSON parsing before the
 * signature check). Responds 200 within milliseconds; heavy work is queued.
 */
webhooksRouter.post(
  '/razorpay',
  raw({ type: 'application/json', limit: '256kb' }),
  async (req, res) => {
    const signature = req.header('x-razorpay-signature') ?? '';
    const rawBody = req.body as Buffer;

    if (!Buffer.isBuffer(rawBody) || !verifyWebhookSignature(rawBody, signature)) {
      logger.warn({ ip: req.ip }, 'razorpay_webhook_bad_signature');
      return res.status(401).json({ error: 'bad_signature' });
    }

    let parsed: { event: string; created_at?: number; payload?: { payment?: { entity?: { id?: string } } } };
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }

    const eventId =
      req.header('x-razorpay-event-id') ??
      `${parsed.event}:${parsed.payload?.payment?.entity?.id ?? ''}:${parsed.created_at ?? ''}`;

    try {
      const we = await prisma.webhookEvent.create({
        data: {
          gateway: 'razorpay',
          eventId,
          eventType: parsed.event,
          signature,
          payload: parsed as unknown as Prisma.InputJsonValue,
        },
      });
      await webhookQueue.add('process', { webhookEventId: we.id });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Duplicate eventId — already received. Idempotent ack.
        return res.status(200).json({ ok: true, duplicate: true });
      }
      logger.error({ err }, 'webhook_persist_failed');
      return res.status(500).json({ error: 'internal' });
    }

    return res.status(200).json({ ok: true });
  },
);

/**
 * Exotel call-status webhook (Phase 7). IP-allowlisted; form-urlencoded body.
 * Records call status/duration onto the matching CallLog by SID. Always acks 200
 * so Exotel does not retry into our error path.
 */
webhooksRouter.post(
  '/exotel',
  raw({ type: ['application/x-www-form-urlencoded', 'application/json', 'text/*'], limit: '64kb' }),
  async (req, res) => {
    const allowlist = env.EXOTEL_WEBHOOK_ALLOWLIST;
    const ip = (req.ip ?? '').replace('::ffff:', '');
    if (allowlist.length > 0 && !allowlist.includes(ip)) {
      logger.warn({ ip }, 'exotel_webhook_ip_blocked');
      return res.status(403).json({ error: 'forbidden' });
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    let params: URLSearchParams;
    try {
      // Exotel posts form-urlencoded; tolerate JSON too.
      params = rawBody.trimStart().startsWith('{')
        ? new URLSearchParams(Object.entries(JSON.parse(rawBody) as Record<string, string>))
        : new URLSearchParams(rawBody);
    } catch {
      return res.status(400).json({ error: 'invalid_body' });
    }

    const exotelSid = params.get('CallSid') ?? params.get('Sid') ?? '';
    const status = (params.get('Status') ?? params.get('CallStatus') ?? 'completed').toLowerCase();
    const durationRaw = params.get('DialCallDuration') ?? params.get('CallDuration');
    const durationSec = durationRaw ? Number.parseInt(durationRaw, 10) || null : null;

    if (!exotelSid) return res.status(200).json({ ok: true, ignored: true });

    try {
      await recordCallStatus({ exotelSid, status, durationSec });
    } catch (err) {
      logger.error({ err }, 'exotel_webhook_record_failed');
    }
    return res.status(200).json({ ok: true });
  },
);