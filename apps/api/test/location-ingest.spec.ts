import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the IO-bound deps so we can exercise the validation/clamp logic.
const redisSet = vi.fn();
vi.mock('../src/redis.js', () => ({ redis: { set: (...a: unknown[]) => redisSet(...a), incr: vi.fn(), expire: vi.fn() } }));
vi.mock('../src/prisma.js', () => ({ prisma: { trip: { update: vi.fn() } } }));

const getHotLocation = vi.fn();
const getActiveTripByDriver = vi.fn();
vi.mock('../src/modules/tracking/location-store.js', async () => {
  const actual = await vi.importActual<typeof import('../src/modules/tracking/location-store.js')>(
    '../src/modules/tracking/location-store.js',
  );
  return {
    ...actual,
    setHotLocation: vi.fn(),
    getHotLocation: (...a: unknown[]) => getHotLocation(...a),
    getActiveTripByDriver: (...a: unknown[]) => getActiveTripByDriver(...a),
  };
});
vi.mock('../src/modules/tracking/ride-logs.store.js', () => ({ appendRideLog: vi.fn() }));

import { ingestPing } from '../src/realtime/location-ingest.js';

const DRIVER = 'driver-1';
const BOOKING = '11111111-1111-1111-1111-111111111111';

function validPing(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bookingId: BOOKING,
    clientSeq: 1,
    ts: new Date().toISOString(),
    lat: 30.7333,
    lng: 76.7794,
    accuracyM: 8,
    speedKmh: 40,
    headingDeg: 90,
    ...over,
  };
}

beforeEach(() => {
  redisSet.mockReset();
  getHotLocation.mockReset();
  getActiveTripByDriver.mockReset();
  // Default: dedup + throttle pass, no active trip (idle accept).
  redisSet.mockResolvedValue('OK');
  getHotLocation.mockResolvedValue(null);
  getActiveTripByDriver.mockResolvedValue(null);
});

describe('ingestPing validation', () => {
  it('rejects malformed payloads (schema)', async () => {
    const r = await ingestPing(DRIVER, { foo: 'bar' });
    expect(r).toEqual({ ok: false, reason: 'schema' });
  });

  it('rejects a non-uuid bookingId (schema)', async () => {
    const r = await ingestPing(DRIVER, validPing({ bookingId: 'nope' }));
    expect(r.ok).toBe(false);
  });

  it('rejects a future timestamp', async () => {
    const r = await ingestPing(DRIVER, validPing({ ts: new Date(Date.now() + 60_000).toISOString() }));
    expect(r).toEqual({ ok: false, reason: 'future_ts' });
  });

  it('rejects a stale timestamp', async () => {
    const r = await ingestPing(DRIVER, validPing({ ts: new Date(Date.now() - 120_000).toISOString() }));
    expect(r).toEqual({ ok: false, reason: 'stale_ts' });
  });

  it('rejects low-accuracy fixes', async () => {
    const r = await ingestPing(DRIVER, validPing({ accuracyM: 500 }));
    expect(r).toEqual({ ok: false, reason: 'low_accuracy' });
  });

  it('rejects impossible speeds', async () => {
    const r = await ingestPing(DRIVER, validPing({ speedKmh: 500 }));
    expect(r).toEqual({ ok: false, reason: 'impossible_speed' });
  });

  it('rejects out-of-country coordinates', async () => {
    const r = await ingestPing(DRIVER, validPing({ lat: 48.85, lng: 2.35 }));
    expect(r).toEqual({ ok: false, reason: 'out_of_country' });
  });

  it('rejects duplicate clientSeq', async () => {
    redisSet.mockImplementation((key: string) => (key.includes('loc:seq') ? Promise.resolve(null) : Promise.resolve('OK')));
    const r = await ingestPing(DRIVER, validPing());
    expect(r).toEqual({ ok: false, reason: 'dup_seq' });
  });

  it('rejects when throttled', async () => {
    redisSet.mockImplementation((key: string) =>
      key.includes('loc:throttle') ? Promise.resolve(null) : Promise.resolve('OK'),
    );
    const r = await ingestPing(DRIVER, validPing());
    expect(r).toEqual({ ok: false, reason: 'throttle' });
  });

  it('rejects a teleport vs the previous hot location', async () => {
    getHotLocation.mockResolvedValue({ lat: 30.7333, lng: 76.7794, ts: Date.now() - 1000 });
    const r = await ingestPing(DRIVER, validPing({ lat: 31.634, lng: 74.8723 }));
    expect(r).toEqual({ ok: false, reason: 'teleport' });
  });

  it('accepts a clean ping (idle, no active trip)', async () => {
    const r = await ingestPing(DRIVER, validPing());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bookingId).toBe(BOOKING);
      expect(r.public.lat).toBeCloseTo(30.7333, 4);
      expect(r.phase).toBe('idle');
    }
  });

  it('skips throttle on the REST fallback path', async () => {
    redisSet.mockImplementation((key: string) =>
      key.includes('loc:throttle') ? Promise.resolve(null) : Promise.resolve('OK'),
    );
    const r = await ingestPing(DRIVER, validPing(), { skipThrottle: true });
    expect(r.ok).toBe(true);
  });
});
