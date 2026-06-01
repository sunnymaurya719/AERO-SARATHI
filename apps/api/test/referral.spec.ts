import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  refFindUnique: vi.fn(),
  refFindFirst: vi.fn(),
  refCreate: vi.fn(),
  refUpdate: vi.fn(),
  refCount: vi.fn(),
  bookingCount: vi.fn(),
  creditWallet: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    user: { findUnique: h.userFindUnique, update: h.userUpdate },
    referral: { findUnique: h.refFindUnique, findFirst: h.refFindFirst, create: h.refCreate, update: h.refUpdate, count: h.refCount },
    booking: { count: h.bookingCount },
  },
}));
vi.mock('../src/modules/wallet/wallet.service.js', () => ({
  creditWallet: (...a: unknown[]) => h.creditWallet(...a),
}));
vi.mock('../src/env.js', () => ({
  env: {
    LOG_LEVEL: 'silent',
    REFERRAL_ENABLED: true,
    REFERRAL_MONTHLY_CAP: 20,
    REFERRAL_REFERRER_REWARD_PAISE: 10000,
    REFERRAL_REFEREE_REWARD_PAISE: 10000,
  },
}));

import {
  referralCodeFor,
  isSelfReferral,
  monthlyCapReached,
  applyReferral,
  rewardReferralOnFirstTrip,
} from '../src/modules/referral/referral.service.js';

describe('referralCodeFor (pure)', () => {
  it('is deterministic and prefixed', () => {
    const a = referralCodeFor('user-1');
    expect(a).toBe(referralCodeFor('user-1'));
    expect(a).toMatch(/^AERO-[A-Z2-9]{6}$/);
  });
  it('differs for different users', () => {
    expect(referralCodeFor('user-1')).not.toBe(referralCodeFor('user-2'));
  });
});

describe('isSelfReferral / monthlyCapReached (pure)', () => {
  it('detects self referral', () => {
    expect(isSelfReferral('u1', 'u1')).toBe(true);
    expect(isSelfReferral('u1', 'u2')).toBe(false);
  });
  it('detects cap', () => {
    expect(monthlyCapReached(20, 20)).toBe(true);
    expect(monthlyCapReached(19, 20)).toBe(false);
  });
});

describe('applyReferral', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));

  it('rejects invalid codes', async () => {
    h.userFindUnique.mockResolvedValue(null);
    await expect(applyReferral({ refereeId: 'r1', code: 'AERO-XXXXXX' })).rejects.toThrow();
  });

  it('blocks self referral', async () => {
    h.userFindUnique.mockResolvedValue({ id: 'r1' });
    await expect(applyReferral({ refereeId: 'r1', code: 'AERO-ABCDEF' })).rejects.toThrow();
  });

  it('blocks a referee that already has a referral', async () => {
    h.userFindUnique.mockResolvedValue({ id: 'referrer' });
    h.refFindUnique.mockResolvedValue({ id: 'existing' });
    await expect(applyReferral({ refereeId: 'r1', code: 'AERO-ABCDEF' })).rejects.toThrow();
  });

  it('blocks a reused device', async () => {
    h.userFindUnique.mockResolvedValue({ id: 'referrer' });
    h.refFindUnique.mockResolvedValue(null);
    h.refFindFirst.mockResolvedValue({ id: 'dev' });
    await expect(applyReferral({ refereeId: 'r1', code: 'AERO-ABCDEF', deviceHash: 'dev1' })).rejects.toThrow();
  });

  it('creates a pending referral', async () => {
    h.userFindUnique.mockResolvedValue({ id: 'referrer' });
    h.refFindUnique.mockResolvedValue(null);
    h.refCreate.mockResolvedValue({ id: 'ref-new' });
    const r = await applyReferral({ refereeId: 'r1', code: 'AERO-ABCDEF' });
    expect(r.id).toBe('ref-new');
    expect(h.userUpdate).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { referredById: 'referrer' } });
  });
});

describe('rewardReferralOnFirstTrip', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));

  it('skips when no pending referral', async () => {
    h.refFindUnique.mockResolvedValue(null);
    expect(await rewardReferralOnFirstTrip('r1')).toBe('skipped');
  });

  it('skips when not the first completed trip', async () => {
    h.refFindUnique.mockResolvedValue({ id: 'ref', status: 'PENDING', referrerId: 'rr', refereeId: 'r1' });
    h.bookingCount.mockResolvedValue(2);
    expect(await rewardReferralOnFirstTrip('r1')).toBe('skipped');
    expect(h.creditWallet).not.toHaveBeenCalled();
  });

  it('rejects when monthly cap reached', async () => {
    h.refFindUnique.mockResolvedValue({ id: 'ref', status: 'PENDING', referrerId: 'rr', refereeId: 'r1' });
    h.bookingCount.mockResolvedValue(1);
    h.refCount.mockResolvedValue(20);
    expect(await rewardReferralOnFirstTrip('r1')).toBe('rejected');
    expect(h.creditWallet).not.toHaveBeenCalled();
  });

  it('rewards both sides and marks rewarded', async () => {
    h.refFindUnique.mockResolvedValue({ id: 'ref', status: 'PENDING', referrerId: 'rr', refereeId: 'r1' });
    h.bookingCount.mockResolvedValue(1);
    h.refCount.mockResolvedValue(0);
    expect(await rewardReferralOnFirstTrip('r1')).toBe('rewarded');
    expect(h.creditWallet).toHaveBeenCalledTimes(2);
    const update = h.refUpdate.mock.calls.at(-1)?.[0] as { data: { status: string } };
    expect(update.data.status).toBe('REWARDED');
  });
});
