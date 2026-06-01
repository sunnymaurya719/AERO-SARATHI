/**
 * Referrals (Phase 6 §8.1). A referrer shares a code; the referee applies it at
 * signup and both are rewarded (to wallet) once the referee completes their
 * first trip. Fraud guards: self-referral block, one referral per referee,
 * device dedup and a monthly reward cap per referrer.
 */
import { createHash } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { logger } from '../../logger.js';
import { creditWallet } from '../wallet/wallet.service.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // base32, no ambiguous chars

/** PURE: deterministic referral code for a user id. */
export function referralCodeFor(userId: string): string {
  const digest = createHash('sha256').update(userId).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[digest[i]! % CODE_ALPHABET.length];
  return `AERO-${out}`;
}

/** PURE: a user may not refer themselves. */
export function isSelfReferral(referrerId: string, refereeId: string): boolean {
  return referrerId === refereeId;
}

/** PURE: monthly reward cap reached? */
export function monthlyCapReached(rewardedThisMonth: number, cap = env.REFERRAL_MONTHLY_CAP): boolean {
  return rewardedThisMonth >= cap;
}

/** Generate + persist the user's referral code if not already set. */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
  if (user?.referralCode) return user.referralCode;
  const code = referralCodeFor(userId);
  await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
  return code;
}

/** Apply a referral code for a new referee. Creates a PENDING referral. */
export async function applyReferral(input: {
  refereeId: string;
  code: string;
  deviceHash?: string;
}): Promise<{ id: string }> {
  if (!env.REFERRAL_ENABLED) throw Errors.validation('referrals_disabled');

  const referrer = await prisma.user.findUnique({ where: { referralCode: input.code }, select: { id: true } });
  if (!referrer) throw Errors.validation('invalid_referral_code');
  if (isSelfReferral(referrer.id, input.refereeId)) throw Errors.validation('self_referral_blocked');

  const existing = await prisma.referral.findUnique({ where: { refereeId: input.refereeId } });
  if (existing) throw Errors.conflict('referee_already_referred');

  if (input.deviceHash) {
    const sameDevice = await prisma.referral.findFirst({
      where: { deviceHash: input.deviceHash, referrerId: referrer.id },
    });
    if (sameDevice) throw Errors.validation('device_already_used');
  }

  const referral = await prisma.referral.create({
    data: {
      referrerId: referrer.id,
      refereeId: input.refereeId,
      code: input.code,
      status: 'PENDING',
      deviceHash: input.deviceHash ?? null,
    },
  });
  await prisma.user.update({ where: { id: input.refereeId }, data: { referredById: referrer.id } });
  return { id: referral.id };
}

/**
 * Reward a pending referral once the referee completes their first trip. Both
 * sides are credited to wallet from PROMO_LIABILITY. Idempotent (only PENDING
 * referrals are processed).
 */
export async function rewardReferralOnFirstTrip(refereeId: string): Promise<'rewarded' | 'rejected' | 'skipped'> {
  if (!env.REFERRAL_ENABLED) return 'skipped';

  const referral = await prisma.referral.findUnique({ where: { refereeId } });
  if (!referral || referral.status !== 'PENDING') return 'skipped';

  // Must be the referee's first completed trip.
  const completedCount = await prisma.booking.count({ where: { userId: refereeId, status: 'COMPLETED' } });
  if (completedCount !== 1) return 'skipped';

  // Monthly cap on rewarded referrals per referrer.
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const rewardedThisMonth = await prisma.referral.count({
    where: { referrerId: referral.referrerId, status: 'REWARDED', rewardedAt: { gte: monthStart } },
  });
  if (monthlyCapReached(rewardedThisMonth)) {
    await prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'REJECTED', rejectedReason: 'monthly_cap_reached' },
    });
    logger.warn({ referralId: referral.id, referrerId: referral.referrerId }, 'referral_rejected_monthly_cap');
    return 'rejected';
  }

  await creditWallet({
    userId: referral.referrerId,
    amountPaise: BigInt(env.REFERRAL_REFERRER_REWARD_PAISE),
    source: 'referral',
    refId: referral.id,
    memo: 'referral reward (referrer)',
  });
  await creditWallet({
    userId: referral.refereeId,
    amountPaise: BigInt(env.REFERRAL_REFEREE_REWARD_PAISE),
    source: 'referral',
    refId: referral.id,
    memo: 'referral reward (referee)',
  });

  await prisma.referral.update({
    where: { id: referral.id },
    data: { status: 'REWARDED', rewardedAt: new Date(), rewardTxnId: `referral:${referral.id}` },
  });
  return 'rewarded';
}
