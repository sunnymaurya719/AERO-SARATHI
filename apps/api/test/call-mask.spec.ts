import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  bookingFindUnique: vi.fn(),
  driverFindUnique: vi.fn(),
  callLogCreate: vi.fn(),
  callLogUpdateMany: vi.fn(),
  redisIncr: vi.fn(),
  redisExpire: vi.fn(),
  connectMaskedCall: vi.fn(),
  mongoUpdateMany: vi.fn(),
  mongoInsertOne: vi.fn(),
  mongoCreateIndex: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    booking: { findUnique: h.bookingFindUnique },
    driver: { findUnique: h.driverFindUnique },
    callLog: { create: h.callLogCreate, updateMany: h.callLogUpdateMany },
  },
}));
vi.mock('../src/redis.js', () => ({
  redis: { incr: (...a: unknown[]) => h.redisIncr(...a), expire: (...a: unknown[]) => h.redisExpire(...a) },
}));
vi.mock('../src/integrations/exotel.js', () => ({
  connectMaskedCall: (...a: unknown[]) => h.connectMaskedCall(...a),
}));
vi.mock('../src/mongo.js', () => ({
  getMongo: () => ({
    collection: () => ({
      updateMany: (...a: unknown[]) => h.mongoUpdateMany(...a),
      insertOne: (...a: unknown[]) => h.mongoInsertOne(...a),
      createIndex: (...a: unknown[]) => h.mongoCreateIndex(...a),
    }),
  }),
  connectMongo: async () => ({ collection: () => ({}) }),
}));

import { isCallAllowed, placeMaskedCall, recordCallStatus } from '../src/modules/calls/call-mask.service.js';

describe('isCallAllowed (pure)', () => {
  it('allows only live trip statuses', () => {
    expect(isCallAllowed('DRIVER_ASSIGNED')).toBe(true);
    expect(isCallAllowed('EN_ROUTE')).toBe(true);
    expect(isCallAllowed('ONGOING')).toBe(true);
    expect(isCallAllowed('PENDING')).toBe(false);
    expect(isCallAllowed('COMPLETED')).toBe(false);
    expect(isCallAllowed('CANCELLED')).toBe(false);
  });
});

describe('placeMaskedCall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.redisIncr.mockResolvedValue(1);
    h.redisExpire.mockResolvedValue(1);
  });

  it('rejects when caller is not a party on the booking', async () => {
    h.bookingFindUnique.mockResolvedValue({
      status: 'ONGOING',
      userId: 'owner',
      passengerPhone: '+910000000000',
      driverId: 'd1',
    });
    await expect(
      placeMaskedCall({ bookingId: 'b1', fromRole: 'PASSENGER', actorId: 'someone-else' }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects when the booking is not in a callable status', async () => {
    h.bookingFindUnique.mockResolvedValue({
      status: 'COMPLETED',
      userId: 'u1',
      passengerPhone: '+910000000000',
      driverId: 'd1',
    });
    await expect(
      placeMaskedCall({ bookingId: 'b1', fromRole: 'PASSENGER', actorId: 'u1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('bridges the call and writes the audit log on success', async () => {
    h.bookingFindUnique.mockResolvedValue({
      status: 'ONGOING',
      userId: 'u1',
      passengerPhone: '+910000000000',
      driverId: 'd1',
    });
    h.driverFindUnique.mockResolvedValue({ phone: '+911111111111' });
    h.connectMaskedCall.mockResolvedValue({ sid: 'CA123', status: 'initiated' });
    h.callLogCreate.mockResolvedValue({ id: 'log1' });
    h.mongoInsertOne.mockResolvedValue({});

    const result = await placeMaskedCall({ bookingId: 'b1', fromRole: 'PASSENGER', actorId: 'u1' });

    expect(result).toEqual({ status: 'initiated', callId: 'log1' });
    // Passenger's number rings first, then the driver's.
    expect(h.connectMaskedCall).toHaveBeenCalledWith('+910000000000', '+911111111111');
    expect(h.callLogCreate).toHaveBeenCalled();
    expect(h.mongoInsertOne).toHaveBeenCalled();
  });

  it('enforces the hourly rate limit', async () => {
    h.bookingFindUnique.mockResolvedValue({
      status: 'ONGOING',
      userId: 'u1',
      passengerPhone: '+910000000000',
      driverId: 'd1',
    });
    h.redisIncr.mockResolvedValue(999);
    await expect(
      placeMaskedCall({ bookingId: 'b1', fromRole: 'PASSENGER', actorId: 'u1' }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('recordCallStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates Postgres + Mongo by SID', async () => {
    h.callLogUpdateMany.mockResolvedValue({ count: 1 });
    h.mongoUpdateMany.mockResolvedValue({});
    await recordCallStatus({ exotelSid: 'CA123', status: 'completed', durationSec: 42 });
    expect(h.callLogUpdateMany).toHaveBeenCalledWith({
      where: { exotelSid: 'CA123' },
      data: { status: 'completed', durationSec: 42 },
    });
    expect(h.mongoUpdateMany).toHaveBeenCalled();
  });
});
