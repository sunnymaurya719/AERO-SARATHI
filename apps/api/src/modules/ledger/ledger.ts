/**
 * Double-entry ledger core (Phase 6 §7.1) — the single correctness anchor for
 * all money movement. No balance is ever stored as a mutable column; balances
 * are derived from immutable `LedgerEntry` rows (and cached in Redis).
 *
 * Invariant: every `txnId` group sums DEBIT == CREDIT. Enforced at write time
 * by `assertBalanced` (pure, unit-tested) and globally by the nightly
 * `reconcile` job.
 */
import { randomUUID } from 'node:crypto';
import type { LedgerAccountType, LedgerDirection, Prisma, PrismaClient } from '@aero/db';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { logger } from '../../logger.js';

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

export interface AccountRef {
  type: LedgerAccountType;
  ownerId?: string | null;
}

export interface LedgerLeg {
  account: AccountRef;
  direction: LedgerDirection;
  amountPaise: bigint;
}

export interface PostTxnInput {
  refType: string;
  refId: string;
  legs: LedgerLeg[];
  memo?: string;
  /** Stable id for idempotency; auto-generated when omitted. */
  txnId?: string;
}

type Tx = Prisma.TransactionClient | PrismaClient;

const balKey = (type: LedgerAccountType, ownerId?: string | null): string =>
  `ledger:bal:${type}:${ownerId ?? 'platform'}`;

/**
 * PURE balance check. Throws on: fewer than two legs, non-positive amount, or
 * DEBIT != CREDIT. No I/O — fully unit-tested.
 */
export function assertBalanced(legs: Pick<LedgerLeg, 'direction' | 'amountPaise'>[]): void {
  if (legs.length < 2) throw new LedgerError('a balanced txn needs at least two legs');
  let debit = 0n;
  let credit = 0n;
  for (const leg of legs) {
    if (leg.amountPaise <= 0n) throw new LedgerError('leg amount must be positive');
    if (leg.direction === 'DEBIT') debit += leg.amountPaise;
    else credit += leg.amountPaise;
  }
  if (debit !== credit) throw new LedgerError(`unbalanced txn: debit ${debit} != credit ${credit}`);
}

async function resolveAccountId(tx: Tx, ref: AccountRef): Promise<string> {
  const existing = await tx.ledgerAccount.findFirst({
    where: { type: ref.type, ownerId: ref.ownerId ?? null },
  });
  if (existing) return existing.id;
  const created = await tx.ledgerAccount.create({
    data: { type: ref.type, ownerId: ref.ownerId ?? null },
  });
  return created.id;
}

/**
 * Post a balanced double-entry transaction. Idempotent on `txnId`: if entries
 * already exist for that id, the call is a no-op and returns the same id.
 */
export async function postTxn(input: PostTxnInput): Promise<string> {
  assertBalanced(input.legs);
  const txnId = input.txnId ?? randomUUID();

  await prisma.$transaction(async (tx) => {
    const dup = await tx.ledgerEntry.findFirst({ where: { txnId } });
    if (dup) return; // already posted — idempotent

    for (const leg of input.legs) {
      const accountId = await resolveAccountId(tx, leg.account);
      await tx.ledgerEntry.create({
        data: {
          txnId,
          accountId,
          direction: leg.direction,
          amountPaise: leg.amountPaise,
          refType: input.refType,
          refId: input.refId,
          memo: input.memo ?? null,
        },
      });
    }
  });

  // Invalidate cached balances for touched accounts (best-effort).
  await Promise.allSettled(input.legs.map((l) => redis.del(balKey(l.account.type, l.account.ownerId))));
  return txnId;
}

/** Balance = Σcredit − Σdebit for an account. Cached in Redis, recomputable. */
export async function balanceOf(type: LedgerAccountType, ownerId?: string | null): Promise<bigint> {
  const key = balKey(type, ownerId);
  const cached = await redis.get(key).catch(() => null);
  if (cached != null) {
    try {
      return BigInt(cached);
    } catch {
      /* fall through to recompute */
    }
  }

  const account = await prisma.ledgerAccount.findFirst({ where: { type, ownerId: ownerId ?? null } });
  if (!account) return 0n;

  const grouped = await prisma.ledgerEntry.groupBy({
    by: ['direction'],
    where: { accountId: account.id },
    _sum: { amountPaise: true },
  });
  let credit = 0n;
  let debit = 0n;
  for (const g of grouped) {
    const sum = g._sum.amountPaise ?? 0n;
    if (g.direction === 'CREDIT') credit = sum;
    else debit = sum;
  }
  const balance = credit - debit;
  await redis.set(key, balance.toString(), 'EX', 300).catch(() => undefined);
  return balance;
}

/**
 * Global integrity check: Σdebit across the whole ledger must equal Σcredit.
 * Returns the drift (0n when healthy). The nightly worker pages on non-zero.
 */
export async function reconcile(): Promise<{ debit: bigint; credit: bigint; drift: bigint }> {
  const grouped = await prisma.ledgerEntry.groupBy({
    by: ['direction'],
    _sum: { amountPaise: true },
  });
  let credit = 0n;
  let debit = 0n;
  for (const g of grouped) {
    const sum = g._sum.amountPaise ?? 0n;
    if (g.direction === 'CREDIT') credit = sum;
    else debit = sum;
  }
  const drift = debit - credit;
  if (drift !== 0n) logger.error({ debit, credit, drift }, 'ledger_reconcile_drift');
  return { debit, credit, drift };
}

/** Convenience: post a simple two-leg transfer (from debit → to credit). */
export async function transfer(opts: {
  from: AccountRef;
  to: AccountRef;
  amountPaise: bigint;
  refType: string;
  refId: string;
  memo?: string;
  txnId?: string;
}): Promise<string> {
  return postTxn({
    refType: opts.refType,
    refId: opts.refId,
    memo: opts.memo,
    txnId: opts.txnId,
    legs: [
      { account: opts.from, direction: 'DEBIT', amountPaise: opts.amountPaise },
      { account: opts.to, direction: 'CREDIT', amountPaise: opts.amountPaise },
    ],
  });
}
