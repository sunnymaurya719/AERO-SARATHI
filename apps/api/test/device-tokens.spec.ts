import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    deviceToken: { upsert: h.upsert, updateMany: h.updateMany },
  },
}));

import { registerDeviceToken, revokeDeviceToken } from '../src/modules/device-tokens/device-tokens.service.js';

describe('registerDeviceToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts on the unique token, re-pointing it at the current user', async () => {
    h.upsert.mockResolvedValue({});
    await registerDeviceToken({ userId: 'u1', token: 'tok-abc-123', platform: 'ANDROID', appVersion: '0.7.0' });

    expect(h.upsert).toHaveBeenCalledTimes(1);
    const arg = h.upsert.mock.calls[0]![0] as {
      where: { token: string };
      create: { userId: string; platform: string };
      update: { userId: string; revokedAt: null };
    };
    expect(arg.where).toEqual({ token: 'tok-abc-123' });
    expect(arg.create.userId).toBe('u1');
    expect(arg.create.platform).toBe('ANDROID');
    expect(arg.update.userId).toBe('u1');
    expect(arg.update.revokedAt).toBeNull();
  });
});

describe('revokeDeviceToken', () => {
  beforeEach(() => vi.clearAllMocks());

  it('soft-revokes only the caller\'s active token', async () => {
    h.updateMany.mockResolvedValue({ count: 1 });
    await revokeDeviceToken('u1', 'tok-abc-123');

    const arg = h.updateMany.mock.calls[0]![0] as {
      where: { token: string; userId: string; revokedAt: null };
      data: { revokedAt: Date };
    };
    expect(arg.where).toEqual({ token: 'tok-abc-123', userId: 'u1', revokedAt: null });
    expect(arg.data.revokedAt).toBeInstanceOf(Date);
  });
});
