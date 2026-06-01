import type { Request, Response, NextFunction } from 'express';
import { redis } from '../redis.js';
import { Errors } from '../errors.js';

const TTL_SECONDS = 60 * 60 * 24; // 24h

/**
 * Requires an Idempotency-Key header. If a result was already stored for this
 * key, replays it. Otherwise attaches helpers to persist the result.
 */
export async function idempotency(req: Request, res: Response, next: NextFunction): Promise<void> {
  const key = req.header('idempotency-key');
  if (!key) return next(Errors.validation('Idempotency-Key header is required'));

  const storeKey = `idem:${req.user?.id ?? 'anon'}:${key}`;
  const existing = await redis.get(storeKey);
  if (existing) {
    const cached = JSON.parse(existing) as { status: number; body: unknown };
    res.status(cached.status).json(cached.body);
    return;
  }

  // Wrap res.json to capture and persist the first successful response.
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      void redis.set(storeKey, JSON.stringify({ status: res.statusCode, body }), 'EX', TTL_SECONDS);
    }
    return originalJson(body);
  };

  next();
}
