/**
 * Phase 8 — Workstream B: point-in-polygon zone assignment.
 *
 * Replaces the implicit coarse-grid `zoneOf` (Phase 6) for multi-city: a
 * lat/lng is assigned to a city's Zone by testing GeoJSON polygons. All
 * functions here are PURE (no DB, no IO) and unit-tested.
 */

/** A GeoJSON Polygon coordinate ring: array of [lng, lat] pairs. */
export type Ring = Array<[number, number]>;

/**
 * GeoJSON Polygon coordinates: an array of linear rings. The first ring is the
 * outer boundary; subsequent rings are holes. We accept the raw `coordinates`
 * array as stored in `Zone.polygon`.
 */
export type PolygonCoords = Ring[];

/**
 * PURE: ray-casting point-in-polygon for a single ring. Counts how many times a
 * horizontal ray from the point crosses the ring's edges; odd = inside.
 * Coordinates are GeoJSON order [lng, lat].
 */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const xi = a[0];
    const yi = a[1];
    const xj = b[0];
    const yj = b[1];
    // Does the edge straddle the horizontal line at `lat`, and is the point to
    // the left of the edge's intersection with that line?
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * PURE: point-in-polygon honoring holes. Inside the outer ring AND not inside
 * any hole ring.
 */
export function pointInPolygon(lng: number, lat: number, polygon: PolygonCoords): boolean {
  if (polygon.length === 0) return false;
  const outer = polygon[0]!;
  if (!pointInRing(lng, lat, outer)) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i]!)) return false; // inside a hole
  }
  return true;
}

/** A minimal zone shape for assignment (id/code + its polygon). */
export interface ZoneShape {
  id: string;
  code: string;
  polygon: PolygonCoords;
}

/**
 * PURE: find the first zone whose polygon contains the given lat/lng. Returns
 * `null` if the point falls outside every zone. Zones are tested in the order
 * provided; callers should order by specificity if zones can overlap.
 */
export function assignZone(lat: number, lng: number, zones: ZoneShape[]): ZoneShape | null {
  for (const zone of zones) {
    if (pointInPolygon(lng, lat, zone.polygon)) return zone;
  }
  return null;
}

/**
 * PURE: validate that a value is a well-formed GeoJSON Polygon coordinates
 * array — a non-empty array of rings, each a closed ring of ≥ 4 [lng,lat]
 * points (GeoJSON requires the first and last point to coincide).
 */
export function isValidPolygon(value: unknown): value is PolygonCoords {
  if (!Array.isArray(value) || value.length === 0) return false;
  for (const ring of value) {
    if (!Array.isArray(ring) || ring.length < 4) return false;
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) return false;
      const [lng, lat] = pt as [unknown, unknown];
      if (typeof lng !== 'number' || typeof lat !== 'number') return false;
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    }
    const first = ring[0] as [number, number];
    const last = ring[ring.length - 1] as [number, number];
    if (first[0] !== last[0] || first[1] !== last[1]) return false; // not closed
  }
  return true;
}
