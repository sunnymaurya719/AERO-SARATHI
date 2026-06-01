export interface FareInput {
  distanceKm: number;
  durationMin: number;
  scheduledAt: Date;
  rule: {
    baseFare: number;
    baseKm: number;
    perKm: number;
    perMin: number;
    nightSurcharge: number;
    minFare: number;
    tokenPercent: number;
  };
}

export interface FareBreakdown {
  base: number;
  distance: number;
  time: number;
  nightSurcharge: number;
  subtotal: number;
  total: number;
  tokenAmount: number;
  balanceAmount: number;
}

/**
 * Pure fare computation. All amounts in paise (integer). No IO.
 * Night surcharge applies for trips scheduled 22:00–05:59 (IST).
 */
export function computeFare(input: FareInput): FareBreakdown {
  const { distanceKm, durationMin, scheduledAt, rule } = input;

  const base = rule.baseFare;
  const extraKm = Math.max(0, distanceKm - rule.baseKm);
  const distance = Math.round(extraKm * rule.perKm);
  const time = Math.round(durationMin * rule.perMin);

  const subtotalBeforeSurcharge = base + distance + time;

  // IST = UTC+5:30. Derive the local hour for the night-surcharge window.
  const istHour = Math.floor((((scheduledAt.getTime() + 5.5 * 3600_000) % 86_400_000) + 86_400_000) % 86_400_000 / 3600_000);
  const isNight = istHour >= 22 || istHour < 6;
  const nightSurcharge = isNight ? Math.round(subtotalBeforeSurcharge * rule.nightSurcharge) : 0;

  const subtotal = subtotalBeforeSurcharge + nightSurcharge;
  const total = Math.max(subtotal, rule.minFare);

  const tokenAmount = Math.round(total * rule.tokenPercent);
  const balanceAmount = total - tokenAmount;

  return { base, distance, time, nightSurcharge, subtotal, total, tokenAmount, balanceAmount };
}
