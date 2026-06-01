/**
 * Driver earnings (Phase 6 §7.4). Each completed trip posts balanced ledger
 * legs: platform cash out (gross), platform revenue (commission), and the
 * driver payable (net). The EMI cut and incentives are layered on separately.
 */
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { postTxn, balanceOf } from '../ledger/ledger.js';

export interface NetBreakdown {
  grossPaise: bigint;
  commissionCutPaise: bigint;
  emiCutPaise: bigint;
  incentivesPaise: bigint;
  netPaise: bigint;
}

/** PURE: per-trip net = gross − commission − emi + incentives. */
export function computeNet(input: {
  grossPaise: bigint;
  commissionRate: number;
  emiCutPaise?: bigint;
  incentivesPaise?: bigint;
}): NetBreakdown {
  const emi = input.emiCutPaise ?? 0n;
  const incentives = input.incentivesPaise ?? 0n;
  // Round commission to the nearest paise.
  const commission = BigInt(Math.round(Number(input.grossPaise) * input.commissionRate));
  const net = input.grossPaise - commission - emi + incentives;
  return {
    grossPaise: input.grossPaise,
    commissionCutPaise: commission,
    emiCutPaise: emi,
    incentivesPaise: incentives,
    netPaise: net,
  };
}

/**
 * Post the per-trip earning legs (excludes EMI cut, which moves later via
 * emi.applyPerTripCut). Idempotent on the booking.
 */
export async function recordTripEarning(input: {
  bookingId: string;
  driverId: string;
  grossPaise: bigint;
  commissionRate?: number;
  incentivesPaise?: bigint;
}): Promise<NetBreakdown> {
  const rate = input.commissionRate ?? env.DEFAULT_COMMISSION_RATE;
  const breakdown = computeNet({ grossPaise: input.grossPaise, commissionRate: rate, incentivesPaise: input.incentivesPaise });
  const payableCredit = input.grossPaise - breakdown.commissionCutPaise; // before EMI

  await postTxn({
    refType: 'booking',
    refId: input.bookingId,
    memo: `trip earning for driver ${input.driverId}`,
    txnId: `earning:${input.bookingId}`,
    legs: [
      { account: { type: 'PLATFORM_CASH', ownerId: null }, direction: 'DEBIT', amountPaise: input.grossPaise },
      { account: { type: 'PLATFORM_REVENUE', ownerId: null }, direction: 'CREDIT', amountPaise: breakdown.commissionCutPaise },
      { account: { type: 'DRIVER_PAYABLE', ownerId: input.driverId }, direction: 'CREDIT', amountPaise: payableCredit },
    ],
  });

  if ((input.incentivesPaise ?? 0n) > 0n) {
    await postTxn({
      refType: 'incentive',
      refId: input.bookingId,
      memo: `incentive for driver ${input.driverId}`,
      txnId: `incentive:${input.bookingId}`,
      legs: [
        { account: { type: 'PLATFORM_REVENUE', ownerId: null }, direction: 'DEBIT', amountPaise: input.incentivesPaise! },
        { account: { type: 'DRIVER_PAYABLE', ownerId: input.driverId }, direction: 'CREDIT', amountPaise: input.incentivesPaise! },
      ],
    });
  }

  return breakdown;
}

/** Weekly statement payload: per-trip rows + totals + current payable balance. */
export async function buildDriverStatement(
  driverId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<Record<string, unknown>> {
  const bookings = await prisma.booking.findMany({
    where: { driverId, status: 'COMPLETED', completedAt: { gte: periodStart, lte: periodEnd } },
    select: { id: true, code: true, fareTotal: true, actualKm: true, completedAt: true },
    orderBy: { completedAt: 'asc' },
  });

  const plan = await prisma.emiPlan.findFirst({ where: { driverId, status: { in: ['ACTIVE', 'COMPLETED'] } } });
  const emiCollections = plan
    ? await prisma.emiCollection.findMany({
        where: { emiPlanId: plan.id, collectedAt: { gte: periodStart, lte: periodEnd } },
      })
    : [];
  const emiTotal = emiCollections.reduce((s, c) => s + c.amountPaise, 0n);

  const rate = env.DEFAULT_COMMISSION_RATE;
  let gross = 0n;
  let commission = 0n;
  const rows = bookings.map((b) => {
    const g = BigInt(b.fareTotal);
    const net = computeNet({ grossPaise: g, commissionRate: rate });
    gross += g;
    commission += net.commissionCutPaise;
    return {
      bookingCode: b.code,
      grossPaise: g.toString(),
      commissionPaise: net.commissionCutPaise.toString(),
      completedAt: b.completedAt,
    };
  });

  const payable = await balanceOf('DRIVER_PAYABLE', driverId);

  return {
    driverId,
    periodStart,
    periodEnd,
    tripCount: bookings.length,
    grossPaise: gross.toString(),
    commissionPaise: commission.toString(),
    emiCutPaise: emiTotal.toString(),
    netPaise: (gross - commission - emiTotal).toString(),
    payableBalancePaise: payable.toString(),
    trips: rows,
  };
}
