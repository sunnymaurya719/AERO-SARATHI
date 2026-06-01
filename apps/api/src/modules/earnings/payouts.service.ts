/**
 * Manual driver payouts (Phase 6 §7.4). A payout debits DRIVER_PAYABLE and
 * credits PLATFORM_CASH, and is idempotent on the external reference so a
 * retried disbursement never double-posts.
 */
import { prisma } from '../../prisma.js';
import { Errors } from '../../errors.js';
import { postTxn, balanceOf } from '../ledger/ledger.js';

export interface PayoutInput {
  driverId: string;
  amountPaise: bigint;
  method: string;
  reference: string;
  periodStart: Date;
  periodEnd: Date;
  createdById: string;
}

/** Record a manual payout. Idempotent on `reference`. */
export async function recordPayout(input: PayoutInput): Promise<{ id: string; created: boolean }> {
  if (input.amountPaise <= 0n) throw Errors.validation('amount_must_be_positive');

  const existing = await prisma.payout.findUnique({ where: { reference: input.reference } });
  if (existing) return { id: existing.id, created: false };

  const payable = await balanceOf('DRIVER_PAYABLE', input.driverId);
  if (input.amountPaise > payable) {
    throw Errors.validation('amount_exceeds_payable', [
      { field: 'amountPaise', payablePaise: payable.toString() },
    ]);
  }

  await postTxn({
    refType: 'payout',
    refId: input.reference,
    memo: `payout to driver ${input.driverId} via ${input.method}`,
    txnId: `payout:${input.reference}`,
    legs: [
      { account: { type: 'DRIVER_PAYABLE', ownerId: input.driverId }, direction: 'DEBIT', amountPaise: input.amountPaise },
      { account: { type: 'PLATFORM_CASH', ownerId: null }, direction: 'CREDIT', amountPaise: input.amountPaise },
    ],
  });

  const payout = await prisma.payout.create({
    data: {
      driverId: input.driverId,
      amountPaise: input.amountPaise,
      method: input.method,
      reference: input.reference,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      createdById: input.createdById,
    },
  });
  return { id: payout.id, created: true };
}

/** Current amount owed to a driver. */
export async function payableBalance(driverId: string): Promise<bigint> {
  return balanceOf('DRIVER_PAYABLE', driverId);
}
