/**
 * Pure geo helpers used by the location-ingest pipeline, fraud heuristics, trip
 * summary builder, and ETA fallback. No I/O — fully unit-testable.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const R_KM = 6371;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1000;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** India bounding box used to reject obviously-spoofed pings. */
export const INDIA_BBOX = { minLat: 6, minLng: 68, maxLat: 38, maxLng: 98 };

export function insideIndia(p: LatLng): boolean {
  return (
    p.lat >= INDIA_BBOX.minLat &&
    p.lat <= INDIA_BBOX.maxLat &&
    p.lng >= INDIA_BBOX.minLng &&
    p.lng <= INDIA_BBOX.maxLng
  );
}

/** Round a coordinate to ~100m buckets for ETA cache keys. */
export function roundCoord(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Douglas–Peucker simplification. Reduces a dense GPS trail to a polyline with
 * at most `maxPoints` vertices while preserving shape (tolerance in degrees).
 */
export function simplifyPath(points: LatLng[], toleranceDeg = 0.0001, maxPoints = 500): LatLng[] {
  if (points.length <= 2) return [...points];
  let result = douglasPeucker(points, toleranceDeg);
  // If still too dense, progressively coarsen.
  let tol = toleranceDeg;
  while (result.length > maxPoints) {
    tol *= 1.8;
    result = douglasPeucker(points, tol);
  }
  return result;
}

function douglasPeucker(points: LatLng[], tol: number): LatLng[] {
  if (points.length < 3) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > tol) {
    const left = douglasPeucker(points.slice(0, index + 1), tol);
    const right = douglasPeucker(points.slice(index), tol);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

function perpendicularDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const mag = Math.hypot(dx, dy);
  if (mag === 0) return Math.hypot(p.lng - a.lng, p.lat - a.lat);
  const u = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / (mag * mag);
  const cx = a.lng + u * dx;
  const cy = a.lat + u * dy;
  return Math.hypot(p.lng - cx, p.lat - cy);
}

/** Encode a path as a Google encoded polyline (precision 5). */
export function encodePolyline(points: LatLng[]): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    result += encodeNumber(lat - lastLat) + encodeNumber(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result;
}

function encodeNumber(num: number): string {
  let n = num < 0 ? ~(num << 1) : num << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  out += String.fromCharCode(n + 63);
  return out;
}
