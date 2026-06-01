import { describe, it, expect } from 'vitest';
import {
  pointInRing,
  pointInPolygon,
  assignZone,
  isValidPolygon,
  type Ring,
  type PolygonCoords,
  type ZoneShape,
} from '../src/modules/cities/point-in-polygon.js';

// A simple square zone around Chandigarh Sector 17 (lng,lat order, closed).
const square: Ring = [
  [76.70, 30.70],
  [76.80, 30.70],
  [76.80, 30.80],
  [76.70, 30.80],
  [76.70, 30.70],
];

describe('pointInRing', () => {
  it('returns true for a point inside the ring', () => {
    expect(pointInRing(76.75, 30.75, square)).toBe(true);
  });

  it('returns false for a point outside the ring', () => {
    expect(pointInRing(77.00, 30.75, square)).toBe(false);
    expect(pointInRing(76.75, 31.50, square)).toBe(false);
  });
});

describe('pointInPolygon', () => {
  it('respects holes — a point in the hole is outside the polygon', () => {
    const hole: Ring = [
      [76.74, 30.74],
      [76.76, 30.74],
      [76.76, 30.76],
      [76.74, 30.76],
      [76.74, 30.74],
    ];
    const withHole: PolygonCoords = [square, hole];
    expect(pointInPolygon(76.72, 30.72, withHole)).toBe(true); // in outer, not in hole
    expect(pointInPolygon(76.75, 30.75, withHole)).toBe(false); // inside the hole
  });

  it('returns false for an empty polygon', () => {
    expect(pointInPolygon(76.75, 30.75, [])).toBe(false);
  });
});

describe('assignZone', () => {
  const zones: ZoneShape[] = [
    { id: 'z1', code: 'SEC17', polygon: [square] },
    {
      id: 'z2',
      code: 'EAST',
      polygon: [[[76.80, 30.70], [76.90, 30.70], [76.90, 30.80], [76.80, 30.80], [76.80, 30.70]]],
    },
  ];

  it('returns the matching zone', () => {
    expect(assignZone(30.75, 76.75, zones)?.code).toBe('SEC17');
    expect(assignZone(30.75, 76.85, zones)?.code).toBe('EAST');
  });

  it('returns null when the point is outside every zone', () => {
    expect(assignZone(28.61, 77.20, zones)).toBeNull(); // Delhi
  });
});

describe('isValidPolygon', () => {
  it('accepts a closed ring of >= 4 points', () => {
    expect(isValidPolygon([square])).toBe(true);
  });

  it('rejects non-arrays and short rings', () => {
    expect(isValidPolygon(null)).toBe(false);
    expect(isValidPolygon([])).toBe(false);
    expect(isValidPolygon([[[76.7, 30.7], [76.8, 30.7], [76.7, 30.7]]])).toBe(false); // < 4 pts
  });

  it('rejects an unclosed ring', () => {
    const open: Ring = [
      [76.70, 30.70],
      [76.80, 30.70],
      [76.80, 30.80],
      [76.70, 30.80],
    ];
    expect(isValidPolygon([open])).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    const bad = [[[200, 30.7], [76.8, 30.7], [76.8, 30.8], [200, 30.7]]];
    expect(isValidPolygon(bad)).toBe(false);
  });
});
