import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    // Never log secrets or full phone numbers / OTP codes.
    paths: ['req.headers.authorization', 'code', 'otp', 'codeHash', '*.code', '*.otp'],
    remove: true,
  },
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

/** Mask a phone number for safe logging: +91XXXXX1234 */
export function maskPhone(phone: string): string {
  if (phone.length < 4) return '****';
  return phone.slice(0, 3) + 'XXXXX' + phone.slice(-4);
}
