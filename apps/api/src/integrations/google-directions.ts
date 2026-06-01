import { env } from '../env.js';
import { redis } from '../redis.js';
import { logger } from '../logger.js';
import { Errors } from '../errors.js';

export interface DirectionsResult {
  distanceKm: number;
  durationMin: number;
}

function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Resolve driving distance/duration via Google Directions, cached in Redis by
 * rounded coordinates (~110m buckets). In dev without an API key, falls back to
 * a straight-line estimate so the flow remains testable.
 */
export async function getDirections(
  pickup: { lat: number; lng: number },
  drop: { lat: number; lng: number },
  departureAt: Date,
): Promise<DirectionsResult> {
  const key = `dir:${roundCoord(pickup.lat)},${roundCoord(pickup.lng)}:${roundCoord(drop.lat)},${roundCoord(drop.lng)}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached) as DirectionsResult;

  let result: DirectionsResult;

  if (!env.GOOGLE_MAPS_API_KEY) {
    // Dev fallback: haversine * 1.3 road factor, ~35 km/h average.
    const km = haversineKm(pickup, drop) * 1.3;
    result = { distanceKm: Math.round(km * 10) / 10, durationMin: Math.max(5, Math.round((km / 35) * 60)) };
    logger.warn('directions_fallback_estimate (no GOOGLE_MAPS_API_KEY)');
  } else {
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${pickup.lat},${pickup.lng}`);
    url.searchParams.set('destination', `${drop.lat},${drop.lng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set(
      'departure_time',
      String(Math.max(Math.floor(departureAt.getTime() / 1000), Math.floor(Date.now() / 1000) + 60)),
    );
    url.searchParams.set('traffic_model', 'best_guess');
    url.searchParams.set('key', env.GOOGLE_MAPS_API_KEY);

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw Errors.badGateway(`directions_http_${res.status}`);
    const data = (await res.json()) as {
      status: string;
      routes?: Array<{ legs?: Array<{ distance: { value: number }; duration: { value: number }; duration_in_traffic?: { value: number } }> }>;
    };
    const leg = data.routes?.[0]?.legs?.[0];
    if (data.status !== 'OK' || !leg) {
      logger.warn({ status: data.status }, 'directions_failed');
      throw Errors.badGateway(`directions_${data.status}`);
    }
    result = {
      distanceKm: leg.distance.value / 1000,
      durationMin: Math.round((leg.duration_in_traffic?.value ?? leg.duration.value) / 60),
    };
  }

  await redis.set(key, JSON.stringify(result), 'EX', env.GOOGLE_DIRECTIONS_CACHE_TTL);
  return result;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
