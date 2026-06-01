/**
 * Geographic zone bucketing for surge (Phase 6 §6). No geohashing exists yet,
 * so we bucket lat/lng onto a coarse grid. The surge route bucket is the
 * pickup zone — origin-based surge, the standard ride-hail approach.
 */

/** Grid cell size in degrees (~5.5km at the equator). */
export const ZONE_CELL_DEG = 0.05;

/** PURE: bucket a coordinate onto the grid, e.g. "30.70:76.75". */
export function zoneOf(lat: number, lng: number, cell = ZONE_CELL_DEG): string {
  const snap = (n: number): string => (Math.floor(n / cell) * cell).toFixed(2);
  return `${snap(lat)}:${snap(lng)}`;
}

/** PURE: surge route bucket keyed on the pickup zone. */
export function routeBucketOf(pickupLat: number, pickupLng: number): string {
  return zoneOf(pickupLat, pickupLng);
}
