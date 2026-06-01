import { describe, it, expect } from 'vitest';
import { haversineKm, haversineM, insideIndia, roundCoord, simplifyPath, encodePolyline } from '../src/modules/tracking/geo.js';

describe('geo helpers', () => {
  it('haversineKm ~0 for identical points', () => {
    expect(haversineKm({ lat: 30.7, lng: 76.7 }, { lat: 30.7, lng: 76.7 })).toBeCloseTo(0, 5);
  });

  it('haversineKm Chandigarh→Amritsar ~190km', () => {
    const km = haversineKm({ lat: 30.7333, lng: 76.7794 }, { lat: 31.634, lng: 74.8723 });
    expect(km).toBeGreaterThan(180);
    expect(km).toBeLessThan(210);
  });

  it('haversineM agrees with haversineKm', () => {
    const a = { lat: 30.7, lng: 76.7 };
    const b = { lat: 30.71, lng: 76.71 };
    expect(haversineM(a, b)).toBeCloseTo(haversineKm(a, b) * 1000, 1);
  });

  it('insideIndia accepts Indian coords and rejects foreign', () => {
    expect(insideIndia({ lat: 30.7, lng: 76.7 })).toBe(true);
    expect(insideIndia({ lat: 48.85, lng: 2.35 })).toBe(false);
    expect(insideIndia({ lat: 0, lng: 0 })).toBe(false);
  });

  it('roundCoord rounds to ~100m precision', () => {
    expect(roundCoord(30.123456)).toBeCloseTo(30.1235, 3);
  });

  it('simplifyPath keeps endpoints and reduces collinear points', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ lat: 30 + i * 0.001, lng: 76 }));
    const out = simplifyPath(line);
    expect(out[0]).toEqual(line[0]);
    expect(out[out.length - 1]).toEqual(line[line.length - 1]);
    expect(out.length).toBeLessThan(line.length);
  });

  it('simplifyPath caps at maxPoints', () => {
    const wiggly = Array.from({ length: 2000 }, (_, i) => ({ lat: 30 + (i % 2) * 0.01, lng: 76 + i * 0.001 }));
    const out = simplifyPath(wiggly, 0.00001, 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it('encodePolyline produces a decodable Google polyline', () => {
    const pts = [
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ];
    // Known reference encoding from Google docs.
    expect(encodePolyline(pts)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });

  it('encodePolyline returns empty string for no points', () => {
    expect(encodePolyline([])).toBe('');
  });
});
