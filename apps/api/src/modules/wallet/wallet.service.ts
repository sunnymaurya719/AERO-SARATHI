/**
 * Customer wallet (Phase 6 §7.2). Balances are derived from the ledger — this
 * module only manages holds (to prevent double-spend across concurrent
 * checkouts) and the credit/debit ledger postings.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { balanceOf, postTxn, type AccountRef } from '../ledger/ledger.js';

const walletAcct = (userId: string): AccountRef => ({ type: 'CUSTOMER_WALLET', ownerId: userId });
const lockKey = (userId: string): string => `wallet:lock:${userId}`;

/** PURE: how much wallet can apply to a payable (never over-applies, never negative). */
export function applicableWallet(balancePaise: bigint, payablePaise: bigint): bigint {
  if (balancePaise <= 0n || payablePaise <= 0n) return 0n;
  return balancePaise < payablePaise ? balancePaise : payablePaise;
}

/** Sum of currently-HELD amounts for a user (reserved, not yet committed). */
export async function heldSum(userId: string): Promise<bigint> {
  const agg = await prisma.walletHold.aggregate({
    where: { userId, status: 'HELD' },
    _sum: { amountPaise: true },
  });
  return agg._sum.amountPaise ?? 0n;
}

/** Spendable balance = ledger balance − active holds. Never negative. */
export async function availableBalance(userId: string): Promise<bigint> {
  const [bal, held] = await Promise.all([balanceOf('CUSTOMER_WALLET', userId), heldSum(userId)]);
  const avail = bal - held;
  return avail > 0n ? avail : 0n;
}

/**
 * Reserve wallet funds for a booking. Serialized per-user via a short Redis
 * lock so two parallel checkouts can't both pass the available-balance check.
 * Idempotent per booking: returns the existing HELD hold if present.
 */
export async function holdWallet(input: {
  userId: string;
  bookingId: string;
  amountPaise: bigint;
}): Promise<{ id: string; amountPaise: bigint }> {
  if (input.amountPaise <= 0n) throw Errors.validation('hold amount must be positive');

  const existing = await prisma.walletHold.findFirst({
    where: { bookingId: input.bookingId, status: 'HELD' },
  });
  if (existing) return { id: existing.id, amountPaise: existing.amountPaise };

  const token = randomUUID();
  const locked = await redis.set(lockKey(input.userId), token, 'EX', 10, 'NX').catch(() => null);
  if (locked !== 'OK') throw Errors.conflict('wallet busy, retry');

  try {
    const avail = await availableBalance(input.userId);
    if (avail < input.amountPaise) {
      throw Errors.validation('insufficient_wallet_balance', [
        { field: 'amountPaise', message: `available ${avail}` },
      ]);
    }
    const hold = await prisma.walletHold.create({
      data: {
        userId: input.userId,
        bookingId: input.bookingId,
        amountPaise: input.amountPaise,
        status: 'HELD',
        expiresAt: new Date(Date.now() + env.WALLET_HOLD_TTL_MIN * 60_000),
      },
    });
    return { id: hold.id, amountPaise: hold.amountPaise };
  } finally {
    // Release the lock only if we still own it.
    const cur = await redis.get(lockKey(input.userId)).catch(() => null);
    if (cur === token) await redis.del(lockKey(input.userId)).catch(() => undefined);
  }
}

/**
 * Commit a hold on payment success: debit the wallet, credit platform cash.
 * Idempotent — a COMMITTED hold is a no-op.
 */
export async function commitWalletHold(bookingId: string): Promise<void> {
  const hold = await prisma.walletHold.findFirst({ where: { bookingId, status: 'HELD' } });
  if (!hold) return;
  await postTxn({
    refType: 'booking',
    refId: bookingId,
    memo: 'wallet applied at checkout',
    txnId: `wallet-commit:${hold.id}`,
    legs: [
      { account: walletAcct(hold.userId), direction: 'DEBIT', amountPaise: hold.amountPaise },
      { account: { type: 'PLATFORM_CASH', ownerId: null }, direction: 'CREDIT', amountPaise: hold.amountPaise },
    ],
  });
  await prisma.walletHold.update({ where: { id: hold.id }, data: { status: 'COMMITTED' } });
}

/** Release a hold on payment failure / timeout. Idempotent. */
export async function releaseWalletHold(bookingId: string): Promise<void> {
  await prisma.walletHold.updateMany({
    where: { bookingId, status: 'HELD' },
    data: { status: 'RELEASED' },
  });
}

export type WalletCreditSource = 'refund' | 'referral' | 'goodwill';

const sourceAccount = (source: WalletCreditSource): AccountRef => {
  switch (source) {
    case 'referral':
      return { type: 'PROMO_LIABILITY', ownerId: null };
    case 'refund':
    case 'goodwill':
    default:
      return { type: 'PLATFORM_CASH', ownerId: null };
  }
};

/** Credit a customer wallet (refund/referral/goodwill). Idempotent on (refType,refId,source). */
export async function creditWallet(input: {
  userId: string;
  amountPaise: bigint;
  source: WalletCreditSource;
  refId: string;
  memo?: string;
}): Promise<string> {
  if (input.amountPaise <= 0n) throw Errors.validation('credit amount must be positive');
  return postTxn({
    refType: input.source,
    refId: input.refId,
    memo: input.memo,
    txnId: `wallet-credit:${input.source}:${input.refId}:${input.userId}`,
    legs: [
      { account: sourceAccount(input.source), direction: 'DEBIT', amountPaise: input.amountPaise },
      { account: walletAcct(input.userId), direction: 'CREDIT', amountPaise: input.amountPaise },
    ],
  });
}

/** Customer-friendly wallet view: balance + recent ledger lines. */
export async function getWalletView(
  userId: string,
  limit = 20,
): Promise<{ balancePaise: string; availablePaise: string; entries: Array<Record<string, unknown>> }> {
  const account = await prisma.ledgerAccount.findFirst({ where: { type: 'CUSTOMER_WALLET', ownerId: userId } });
  const [bal, avail, rows] = await Promise.all([
    balanceOf('CUSTOMER_WALLET', userId),
    availableBalance(userId),
    account
      ? prisma.ledgerEntry.findMany({
          where: { accountId: account.id },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
      : Promise.resolve([]),
  ]);
  return {
    balancePaise: bal.toString(),
    availablePaise: avail.toString(),
    entries: rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      amountPaise: r.amountPaise.toString(),
      refType: r.refType,
      memo: r.memo,
      createdAt: r.createdAt,
    })),
  };
}
