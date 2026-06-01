import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';
import { getDirections } from '../../integrations/google-directions.js';
import { computeFare } from './fare.js';
import { resolveSurgeForRoute } from '../pricing/rules.service.js';
import { recordDemand } from '../pricing/demand.service.js';
import { applySurge } from '../pricing/surge.js';
import type { QuoteRequestInput } from './quotes.schema.js';
import type { FareOption, QuoteResponse, QuoteSurgeInfo, VehicleCategory } from '@aero/types';

/** Build a human-readable surge label, empty when no surge is applied. */
function surgeLabel(multiplier: number, ratio: number): string {
  if (multiplier <= 1.0) return '';
  const reason = ratio >= 1.2 ? 'high demand' : 'peak time';
  return `${multiplier.toFixed(1)}x — ${reason}`;
}

export async function createQuote(input: QuoteRequestInput): Promise<QuoteResponse> {
  const scheduledAt = new Date(input.scheduledAt);
  const now = Date.now();

  const minLeadMs = env.MIN_LEAD_TIME_MIN * 60_000;
  const maxLeadMs = env.MAX_LEAD_TIME_DAYS * 86_400_000;

  if (scheduledAt.getTime() < now + minLeadMs) {
    throw Errors.validation(`scheduledAt must be at least ${env.MIN_LEAD_TIME_MIN} minutes in the future`);
  }
  if (scheduledAt.getTime() > now + maxLeadMs) {
    throw Errors.validation(`scheduledAt must be within ${env.MAX_LEAD_TIME_DAYS} days`);
  }

  const directions = await getDirections(
    { lat: input.pickup.lat, lng: input.pickup.lng },
    { lat: input.drop.lat, lng: input.drop.lng },
    scheduledAt,
  );

  const rules = await prisma.fareRule.findMany({
    where: { effectiveFrom: { lte: new Date() }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (rules.length === 0) throw Errors.notFound('No active fare rules configured');

  // Latest rule per category.
  const byCategory = new Map<VehicleCategory, (typeof rules)[number]>();
  for (const r of rules) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, r);
  }

  const fares: FareOption[] = [...byCategory.values()].map((rule) => {
    const breakdown = computeFare({
      distanceKm: directions.distanceKm,
      durationMin: directions.durationMin,
      scheduledAt,
      rule,
    });
    return {
      category: rule.category,
      total: breakdown.total,
      tokenAmount: breakdown.tokenAmount,
      balanceAmount: breakdown.balanceAmount,
      breakdown,
    };
  });

  // ── Phase 6: dynamic surge ──
  const surge = await resolveSurgeForRoute({
    pickupLat: input.pickup.lat,
    pickupLng: input.pickup.lng,
    at: scheduledAt,
  });
  void recordDemand(surge.routeBucket);

  const multiplier = surge.surgeMultiplier;
  if (multiplier > 1.0) {
    for (const f of fares) {
      const baseTotal = f.total;
      const surgedTotal = applySurge(baseTotal, multiplier);
      const tokenAmount = applySurge(f.tokenAmount, multiplier);
      f.baseTotal = baseTotal;
      f.surgeMultiplier = multiplier;
      f.total = surgedTotal;
      f.tokenAmount = tokenAmount;
      f.balanceAmount = surgedTotal - tokenAmount;
    }
  }

  const surgeInfo: QuoteSurgeInfo = {
    multiplier,
    routeBucket: surge.routeBucket,
    label: surgeLabel(multiplier, surge.breakdown.ratio),
    ruleVersion: surge.ruleVersion,
  };

  const expiresAt = new Date(now + env.QUOTE_TTL_MIN * 60_000);

  const quote = await prisma.quote.create({
    data: {
      pickupAddress: input.pickup.address,
      pickupLat: input.pickup.lat,
      pickupLng: input.pickup.lng,
      dropAddress: input.drop.address,
      dropLat: input.drop.lat,
      dropLng: input.drop.lng,
      scheduledAt,
      distanceKm: directions.distanceKm,
      durationMin: directions.durationMin,
      fares: fares as unknown as object,
      expiresAt,
      routeBucket: surge.routeBucket,
      surgeMultiplier: multiplier,
      surgeRuleVersion: surge.ruleVersion,
      surgeBreakdown: surge.breakdown as unknown as object,
    },
  });

  return {
    quoteId: quote.id,
    distanceKm: directions.distanceKm,
    durationMin: directions.durationMin,
    expiresAt: expiresAt.toISOString(),
    fares,
    surge: surgeInfo,
  };
}
