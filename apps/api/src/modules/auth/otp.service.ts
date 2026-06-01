import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { sendOtp } from '../../integrations/msg91.js';
import { makeLimiter } from '../../middleware/rate-limit.js';
import { logger, maskPhone } from '../../logger.js';

const OTP_TTL_MS = 5 * 60_000;
const MAX_VERIFY_ATTEMPTS = 5;
const DEV_PHONE = '+919999999999';
const DEV_CODE = '123456';

const limitPerPhone = makeLimiter({ keyPrefix: 'otp:phone', points: 3, durationSec: 600 });
const limitPerIpHour = makeLimiter({ keyPrefix: 'otp:ip:h', points: 10, durationSec: 3600 });
const limitPerIpDay = makeLimiter({ keyPrefix: 'otp:ip:d', points: 30, durationSec: 86_400 });

export async function requestOtp(phone: string, ip: string): Promise<{ otpId: string; expiresInSec: number }> {
  await limitPerPhone(phone);
  await limitPerIpHour(ip);
  await limitPerIpDay(ip);

  // Invalidate prior unconsumed codes for this phone.
  await prisma.otpRequest.updateMany({ where: { phone, consumed: false }, data: { consumed: true } });

  const code = env.MSG91_BYPASS && phone === DEV_PHONE ? DEV_CODE : String(randomInt(100_000, 1_000_000));
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  const row = await prisma.otpRequest.create({ data: { phone, codeHash, expiresAt } });

  await sendOtp(phone, code);
  logger.info({ phone: maskPhone(phone), otpId: row.id }, 'otp_requested');

  return { otpId: row.id, expiresInSec: Math.floor(OTP_TTL_MS / 1000) };
}

export async function verifyOtp(phone: string, code: string): Promise<{ userId: string }> {
  const row = await prisma.otpRequest.findFirst({
    where: { phone, consumed: false, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw Errors.unauthorized('OTP expired or missing');

  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    await prisma.otpRequest.update({ where: { id: row.id }, data: { consumed: true } });
    throw Errors.tooMany('OTP locked, request a new code');
  }

  const ok = await bcrypt.compare(code, row.codeHash);
  if (!ok) {
    await prisma.otpRequest.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw Errors.unauthorized('Invalid OTP code');
  }

  await prisma.otpRequest.update({ where: { id: row.id }, data: { consumed: true } });

  const user = await prisma.user.upsert({
    where: { phone },
    update: {},
    create: { phone },
  });

  return { userId: user.id };
}
