import { describe, it, expect } from 'vitest';
import { computeOfferTtlSec } from '../src/modules/assignment/offer.service.js';

const PICKUP = new Date('2026-06-01T13:00:00.000Z');

function minsBefore(mins: number): Date {
  return new Date(PICKUP.getTime() - mins * 60_000);
}

describe('computeOfferTtlSec', () => {
  it('uses the full TTL when pickup is far away (>60 min)', () => {
    expect(computeOfferTtlSec(PICKUP, minsBefore(180))).toBe(60);
  });

  it('uses the full TTL exactly at the 60 min boundary', () => {
    expect(computeOfferTtlSec(PICKUP, minsBefore(60))).toBe(60);
  });

  it('uses the short TTL between 45 and 60 min', () => {
    expect(computeOfferTtlSec(PICKUP, minsBefore(50))).toBe(30);
  });

  it('uses the short TTL exactly at the 45 min boundary', () => {
    expect(computeOfferTtlSec(PICKUP, minsBefore(45))).toBe(30);
  });

  it('uses the very short TTL under 45 min', () => {
    expect(computeOfferTtlSec(PICKUP, minsBefore(20))).toBe(20);
  });

  it('uses the very short TTL when pickup is imminent', () => {
    expect(computeOfferTtlSec(PICKUP, minsBefore(1))).toBe(20);
  });
});
