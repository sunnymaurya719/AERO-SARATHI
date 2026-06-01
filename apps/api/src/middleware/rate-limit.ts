import type { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redis } from '../redis.js';
import { Errors } from '../errors.js';

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

/** Generic IP rate limiter factory. */
export function ipRateLimit(opts: { keyPrefix: string; points: number; durationSec: number }) {
  const limiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: opts.keyPrefix,
    points: opts.points,
    duration: opts.durationSec,
  });

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await limiter.consume(clientIp(req));
      next();
    } catch {
      next(Errors.tooMany());
    }
  };
}

/**
 * Consume a points-based limit by an arbitrary key (e.g. phone). Throws
 * AppError(429) when exhausted. Used inside services for layered limits.
 */
export function makeLimiter(opts: { keyPrefix: string; points: number; durationSec: number }) {
  const limiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: opts.keyPrefix,
    points: opts.points,
    duration: opts.durationSec,
  });
  return async (key: string): Promise<void> => {
    try {
      await limiter.consume(key);
    } catch {
      throw Errors.tooMany('Rate limit exceeded');
    }
  };
}
