import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  holdFindFirst: vi.fn(),
  holdCreate: vi.fn(),
  holdUpdate: vi.fn(),
  holdUpdateMany: vi.fn(),
  holdAggregate: vi.fn(),
  acctFindFirst: vi.fn(),
  entryFindMany: vi.fn(),
  redisSet: vi.fn(),
  redisGet: vi.fn(),
  redisDel: vi.fn(),
  balanceOf: vi.fn(),
  postTxn: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    walletHold: {
      findFirst: h.holdFindFirst,
      create: h.holdCreate,
      update: h.holdUpdate,
      updateMany: h.holdUpdateMany,
      aggregate: h.holdAggregate,
    },
    ledgerAccount: { findFirst: h.acctFindFirst },
    ledgerEntry: { findMany: h.entryFindMany },
  },
}));
vi.mock('../src/redis.js', () => ({
  redis: {
    set: (...a: unknown[]) => h.redisSet(...a),
    get: (...a: unknown[]) => h.redisGet(...a),
    del: (...a: unknown[]) => h.redisDel(...a),
  },
}));
vi.mock('../src/modules/ledger/ledger.js', () => ({
  balanceOf: (...a: unknown[]) => h.balanceOf(...a),
  postTxn: (...a: unknown[]) => h.postTxn(...a),
}));

import {
  applicableWallet,
  availableBalance,
  holdWallet,
  commitWalletHold,
  releaseWalletHold,
  creditWallet,
} from '../src/modules/wallet/wallet.service.js';

describe('applicableWallet (pure)', () => {
  it('applies the lesser of balance and payable', () => {
    expect(applicableWallet(10_000n, 4_000n)).toBe(4_000n);
    expect(applicableWallet(3_000n, 4_000n)).toBe(3_000n);
  });
  it('returns 0 for non-positive inputs', () => {
    expect(applicableWallet(0n, 4_000n)).toBe(0n);
    expect(applicableWallet(10_000n, 0n)).toBe(0n);
    expect(applicableWallet(-5n, 4_000n)).toBe(0n);
  });
});

describe('availableBalance', () => {
  beforeEach(() => {
    h.balanceOf.mockReset();
    h.holdAggregate.mockReset();
  });
  it('subtracts active holds', async () => {
    h.balanceOf.mockResolvedValue(10_000n);
    h.holdAggregate.mockResolvedValue({ _sum: { amountPaise: 3_000n } });
    expect(await availableBalance('u1')).toBe(7_000n);
  });
  it('never returns negative', async () => {
    h.balanceOf.mockResolvedValue(1_000n);
    h.holdAggregate.mockResolvedValue({ _sum: { amountPaise: 5_000n } });
    expect(await availableBalance('u1')).toBe(0n);
  });
  it('treats null hold sum as zero', async () => {
    h.balanceOf.mockResolvedValue(2_000n);
    h.holdAggregate.mockResolvedValue({ _sum: { amountPaise: null } });
    expect(await availableBalance('u1')).toBe(2_000n);
  });
});

describe('holdWallet', () => {
  beforeEach(() => {
    Object.values(h).forEach((f) => f.mockReset());
    h.redisGet.mockResolvedValue('tok');
    h.redisDel.mockResolvedValue(1);
  });

  it('rejects non-positive amounts', async () => {
    await expect(holdWallet({ userId: 'u1', bookingId: 'b1', amountPaise: 0n })).rejects.toThrow();
  });

  it('returns the existing hold (idempotent)', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold-1', amountPaise: 500n });
    const r = await holdWallet({ userId: 'u1', bookingId: 'b1', amountPaise: 500n });
    expect(r.id).toBe('hold-1');
    expect(h.holdCreate).not.toHaveBeenCalled();
  });

  it('throws conflict when the lock is held', async () => {
    h.holdFindFirst.mockResolvedValue(null);
    h.redisSet.mockResolvedValue(null); // lock not acquired
    await expect(holdWallet({ userId: 'u1', bookingId: 'b1', amountPaise: 500n })).rejects.toThrow();
  });

  it('rejects when balance is insufficient', async () => {
    h.holdFindFirst.mockResolvedValue(null);
    h.redisSet.mockResolvedValue('OK');
    h.balanceOf.mockResolvedValue(100n);
    h.holdAggregate.mockResolvedValue({ _sum: { amountPaise: 0n } });
    await expect(holdWallet({ userId: 'u1', bookingId: 'b1', amountPaise: 500n })).rejects.toThrow();
  });

  it('creates a hold when funds are available', async () => {
    h.holdFindFirst.mockResolvedValue(null);
    h.redisSet.mockResolvedValue('OK');
    h.balanceOf.mockResolvedValue(10_000n);
    h.holdAggregate.mockResolvedValue({ _sum: { amountPaise: 0n } });
    h.holdCreate.mockResolvedValue({ id: 'hold-new', amountPaise: 500n });
    const r = await holdWallet({ userId: 'u1', bookingId: 'b1', amountPaise: 500n });
    expect(r.id).toBe('hold-new');
    expect(h.holdCreate).toHaveBeenCalledOnce();
  });
});

describe('commitWalletHold', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));
  it('no-ops when no held hold exists', async () => {
    h.holdFindFirst.mockResolvedValue(null);
    await commitWalletHold('b1');
    expect(h.postTxn).not.toHaveBeenCalled();
  });
  it('posts a debit/credit and marks committed', async () => {
    h.holdFindFirst.mockResolvedValue({ id: 'hold-1', userId: 'u1', amountPaise: 500n });
    h.postTxn.mockResolvedValue('txn-1');
    await commitWalletHold('b1');
    expect(h.postTxn).toHaveBeenCalledOnce();
    expect(h.holdUpdate).toHaveBeenCalledWith({ where: { id: 'hold-1' }, data: { status: 'COMMITTED' } });
  });
});

describe('releaseWalletHold', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));
  it('marks held holds released', async () => {
    h.holdUpdateMany.mockResolvedValue({ count: 1 });
    await releaseWalletHold('b1');
    expect(h.holdUpdateMany).toHaveBeenCalledWith({
      where: { bookingId: 'b1', status: 'HELD' },
      data: { status: 'RELEASED' },
    });
  });
});

describe('creditWallet', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));
  it('rejects non-positive credit', async () => {
    await expect(creditWallet({ userId: 'u1', amountPaise: 0n, source: 'refund', refId: 'r1' })).rejects.toThrow();
  });
  it('posts a referral credit from promo liability', async () => {
    h.postTxn.mockResolvedValue('txn-1');
    await creditWallet({ userId: 'u1', amountPaise: 10_000n, source: 'referral', refId: 'r1' });
    const arg = h.postTxn.mock.calls[0]![0] as { legs: Array<{ account: { type: string }; direction: string }> };
    expect(arg.legs[0]!.account.type).toBe('PROMO_LIABILITY');
    expect(arg.legs[1]!.account.type).toBe('CUSTOMER_WALLET');
  });
});
