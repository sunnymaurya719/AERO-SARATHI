/**
 * EMI tracker (Phase 6 §7.3). For drivers whose vehicle is financed through the
 * platform, a flat cut is retained per completed trip and moved from
 * DRIVER_PAYABLE → EMI_RECEIVABLE via the ledger. Cuts stop once the plan is
 * fully collected; cuts can never push the driver payable negative.
 */
import type { EmiStatus } from '@aero/db';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { balanceOf, postTxn } from '../ledger/ledger.js';

/** PURE: cut = min(perTripCut, remainingDue, payableAvailable), clamped ≥ 0. */
export function computeCut(perTripCutPaise: bigint, remainingDuePaise: bigint, payableAvailablePaise: bigint): bigint {
  const candidates = [perTripCutPaise, remainingDuePaise, payableAvailablePaise];
  let cut = candidates.reduce((min, c) => (c < min ? c : min));
  if (cut < 0n) cut = 0n;
  return cut;
}

/** PURE: plan status after a collection. */
export function planStatusAfter(collectedPaise: bigint, totalDuePaise: bigint): EmiStatus {
  return collectedPaise >= totalDuePaise ? 'COMPLETED' : 'ACTIVE';
}

/** PURE: how far behind a weekly target. 0 when on/ahead of target. */
export function arrears(weeklyTargetPaise: bigint | null, collectedThisWeekPaise: bigint): bigint {
  if (!weeklyTargetPaise || weeklyTargetPaise <= 0n) return 0n;
  const behind = weeklyTargetPaise - collectedThisWeekPaise;
  return behind > 0n ? behind : 0n;
}

/** Activate a financed plan with per-trip cut terms. */
export async function activateEmiPlan(input: {
  emiPlanId: string;
  driverId: string;
  perTripCutPaise: bigint;
  totalDuePaise: bigint;
  weeklyTargetPaise?: bigint | null;
}): Promise<void> {
  await prisma.emiPlan.update({
    where: { id: input.emiPlanId },
    data: {
      driverId: input.driverId,
      perTripCutPaise: input.perTripCutPaise,
      totalDuePaise: input.totalDuePaise,
      weeklyTargetPaise: input.weeklyTargetPaise ?? null,
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
  });
}

/**
 * Retain the per-trip EMI cut on trip completion. Idempotent per booking via
 * the ledger txnId. Returns the collected amount (0n when no active plan or
 * nothing collectable).
 */
export async function applyPerTripCut(input: { driverId: string; bookingId: string }): Promise<bigint> {
  const plan = await prisma.emiPlan.findFirst({
    where: { driverId: input.driverId, status: 'ACTIVE' },
  });
  if (!plan || plan.perTripCutPaise == null || plan.totalDuePaise == null) return 0n;

  const remaining = plan.totalDuePaise - plan.collectedPaise;
  if (remaining <= 0n) {
    await prisma.emiPlan.update({ where: { id: plan.id }, data: { status: 'COMPLETED' } });
    return 0n;
  }

  const payable = await balanceOf('DRIVER_PAYABLE', input.driverId);
  const cut = computeCut(plan.perTripCutPaise, remaining, payable);
  if (cut <= 0n) {
    if (payable <= 0n) logger.warn({ driverId: input.driverId, bookingId: input.bookingId }, 'emi_cut_skipped_no_payable');
    return 0n;
  }

  await postTxn({
    refType: 'emi',
    refId: input.bookingId,
    memo: `per-trip EMI cut for plan ${plan.id}`,
    txnId: `emi-cut:${input.bookingId}`,
    legs: [
      { account: { type: 'DRIVER_PAYABLE', ownerId: input.driverId }, direction: 'DEBIT', amountPaise: cut },
      { account: { type: 'EMI_RECEIVABLE', ownerId: null }, direction: 'CREDIT', amountPaise: cut },
    ],
  });

  await prisma.emiCollection.create({
    data: { emiPlanId: plan.id, bookingId: input.bookingId, amountPaise: cut, source: 'PER_TRIP' },
  });

  const collected = plan.collectedPaise + cut;
  await prisma.emiPlan.update({
    where: { id: plan.id },
    data: { collectedPaise: collected, status: planStatusAfter(collected, plan.totalDuePaise) },
  });
  return cut;
}

/** Record a manual / adjustment collection (e.g. cash top-up). */
export async function recordManualCollection(input: {
  emiPlanId: string;
  amountPaise: bigint;
  source: 'MANUAL' | 'ADJUSTMENT';
}): Promise<void> {
  const plan = await prisma.emiPlan.findUnique({ where: { id: input.emiPlanId } });
  if (!plan || plan.totalDuePaise == null) return;
  await prisma.emiCollection.create({
    data: { emiPlanId: plan.id, amountPaise: input.amountPaise, source: input.source },
  });
  const collected = plan.collectedPaise + input.amountPaise;
  await prisma.emiPlan.update({
    where: { id: plan.id },
    data: { collectedPaise: collected, status: planStatusAfter(collected, plan.totalDuePaise) },
  });
}

/** Driver-facing EMI view: plan + collected/pending + recent collections. */
export async function getDriverEmi(driverId: string): Promise<Record<string, unknown> | null> {
  const plan = await prisma.emiPlan.findFirst({ where: { driverId, status: { in: ['ACTIVE', 'COMPLETED', 'DEFAULTED', 'PAUSED'] } } });
  if (!plan) return null;
  const collections = await prisma.emiCollection.findMany({
    where: { emiPlanId: plan.id },
    orderBy: { collectedAt: 'desc' },
    take: 20,
  });
  const totalDue = plan.totalDuePaise ?? 0n;
  return {
    planId: plan.id,
    status: plan.status,
    perTripCutPaise: (plan.perTripCutPaise ?? 0n).toString(),
    totalDuePaise: totalDue.toString(),
    collectedPaise: plan.collectedPaise.toString(),
    pendingPaise: (totalDue - plan.collectedPaise).toString(),
    weeklyTargetPaise: plan.weeklyTargetPaise?.toString() ?? null,
    collections: collections.map((c) => ({
      id: c.id,
      amountPaise: c.amountPaise.toString(),
      source: c.source,
      collectedAt: c.collectedAt,
    })),
  };
}
