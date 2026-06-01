import type { VehicleCategory } from '@aero/db';
import { prisma } from '../../../prisma.js';
import { Errors } from '../../../errors.js';
import { computeFare } from '../../quotes/fare.js';

export async function listFareRules(category?: VehicleCategory) {
  return prisma.fareRule.findMany({
    where: category ? { category } : {},
    orderBy: [{ category: 'asc' }, { effectiveFrom: 'desc' }],
  });
}

/** The currently-active rule per category (effectiveTo null, effectiveFrom in the past). */
export async function listActiveFareRules() {
  const now = new Date();
  return prisma.fareRule.findMany({
    where: { effectiveTo: null, effectiveFrom: { lte: now } },
    orderBy: { category: 'asc' },
  });
}

export interface CreateFareRuleInput {
  category: VehicleCategory;
  baseFare: number;
  baseKm: number;
  perKm: number;
  perMin: number;
  nightSurcharge: number;
  minFare: number;
  tokenPercent: number;
  effectiveFrom: Date;
  notes?: string;
  createdById: string;
}

/**
 * Append-only: creating a new rule supersedes the prior active rule for the
 * same category (sets its effectiveTo + supersededBy). Never mutates fare math
 * of an existing rule.
 */
export async function createFareRule(input: CreateFareRuleInput) {
  return prisma.$transaction(async (tx) => {
    const prior = await tx.fareRule.findFirst({
      where: { category: input.category, effectiveTo: null },
      orderBy: { effectiveFrom: 'desc' },
    });

    const created = await tx.fareRule.create({
      data: {
        category: input.category,
        baseFare: input.baseFare,
        baseKm: input.baseKm,
        perKm: input.perKm,
        perMin: input.perMin,
        nightSurcharge: input.nightSurcharge,
        minFare: input.minFare,
        tokenPercent: input.tokenPercent,
        effectiveFrom: input.effectiveFrom,
        notes: input.notes,
        createdById: input.createdById,
      },
    });

    if (prior) {
      await tx.fareRule.update({
        where: { id: prior.id },
        data: { effectiveTo: input.effectiveFrom, supersededBy: created.id },
      });
    }

    return created;
  });
}

export interface PreviewInput {
  category: VehicleCategory;
  distanceKm: number;
  durationMin: number;
  scheduledAt: Date;
  rule?: {
    baseFare: number;
    baseKm: number;
    perKm: number;
    perMin: number;
    nightSurcharge: number;
    minFare: number;
    tokenPercent: number;
  };
}

/** Dry-run fare computation. NO DB write. Uses the supplied rule, or the active one. */
export async function previewFare(input: PreviewInput) {
  let rule = input.rule;
  if (!rule) {
    const active = await prisma.fareRule.findFirst({
      where: { category: input.category, effectiveTo: null, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!active) throw Errors.notFound('No active fare rule for this category');
    rule = {
      baseFare: active.baseFare,
      baseKm: active.baseKm,
      perKm: active.perKm,
      perMin: active.perMin,
      nightSurcharge: active.nightSurcharge,
      minFare: active.minFare,
      tokenPercent: active.tokenPercent,
    };
  }
  return computeFare({
    distanceKm: input.distanceKm,
    durationMin: input.durationMin,
    scheduledAt: input.scheduledAt,
    rule,
  });
}
