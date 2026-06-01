import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  txnFindFirst: vi.fn(),
  entryCreate: vi.fn(),
  acctFindFirst: vi.fn(),
  acctCreate: vi.fn(),
  entryGroupBy: vi.fn(),
  acctFindFirstTop: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
}));
const {
  txnFindFirst,
  entryCreate,
  acctFindFirst,
  acctCreate,
  entryGroupBy,
  acctFindFirstTop,
  redisGet,
  redisSet,
  redisDel,
} = h;

const fakeTx = {
  ledgerEntry: { findFirst: h.txnFindFirst, create: h.entryCreate },
  ledgerAccount: { findFirst: h.acctFindFirst, create: h.acctCreate },
};

vi.mock('../src/prisma.js', () => ({
  prisma: {
    $transaction: (cb: (tx: typeof fakeTx) => Promise<void>) => cb(fakeTx),
    ledgerAccount: { findFirst: h.acctFindFirstTop },
    ledgerEntry: { groupBy: h.entryGroupBy },
  },
}));

vi.mock('../src/redis.js', () => ({
  redis: {
    get: (...a: unknown[]) => h.redisGet(...a),
    set: (...a: unknown[]) => h.redisSet(...a),
    del: (...a: unknown[]) => h.redisDel(...a),
  },
}));

import { assertBalanced, postTxn, balanceOf, reconcile, transfer, LedgerError } from '../src/modules/ledger/ledger.js';

const leg = (direction: 'DEBIT' | 'CREDIT', amt: bigint) => ({
  account: { type: 'CUSTOMER_WALLET' as const, ownerId: 'u1' },
  direction,
  amountPaise: amt,
});

describe('assertBalanced (pure)', () => {
  it('accepts a balanced two-leg txn', () => {
    expect(() => assertBalanced([leg('DEBIT', 100n), leg('CREDIT', 100n)])).not.toThrow();
  });
  it('accepts a balanced multi-leg txn', () => {
    expect(() =>
      assertBalanced([leg('DEBIT', 100n), leg('CREDIT', 60n), leg('CREDIT', 40n)]),
    ).not.toThrow();
  });
  it('rejects an unbalanced txn', () => {
    expect(() => assertBalanced([leg('DEBIT', 100n), leg('CREDIT', 90n)])).toThrow(LedgerError);
  });
  it('rejects a single-leg txn', () => {
    expect(() => assertBalanced([leg('DEBIT', 100n)])).toThrow(LedgerError);
  });
  it('rejects a zero amount', () => {
    expect(() => assertBalanced([leg('DEBIT', 0n), leg('CREDIT', 0n)])).toThrow(LedgerError);
  });
  it('rejects a negative amount', () => {
    expect(() => assertBalanced([leg('DEBIT', -5n), leg('CREDIT', -5n)])).toThrow(LedgerError);
  });
  it('handles large balanced amounts', () => {
    expect(() => assertBalanced([leg('DEBIT', 10_000_000_000n), leg('CREDIT', 10_000_000_000n)])).not.toThrow();
  });
});

describe('postTxn', () => {
  beforeEach(() => {
    txnFindFirst.mockReset();
    entryCreate.mockReset();
    acctFindFirst.mockReset();
    acctCreate.mockReset();
    redisDel.mockReset().mockResolvedValue(1);
    acctFindFirst.mockResolvedValue({ id: 'acc-1' });
    entryCreate.mockResolvedValue({});
  });

  it('rejects an unbalanced txn before any write', async () => {
    await expect(
      postTxn({ refType: 'booking', refId: 'b1', legs: [leg('DEBIT', 100n), leg('CREDIT', 50n)] }),
    ).rejects.toThrow(LedgerError);
    expect(entryCreate).not.toHaveBeenCalled();
  });

  it('writes both legs for a balanced txn', async () => {
    txnFindFirst.mockResolvedValue(null);
    await postTxn({ refType: 'booking', refId: 'b1', legs: [leg('DEBIT', 100n), leg('CREDIT', 100n)] });
    expect(entryCreate).toHaveBeenCalledTimes(2);
  });

  it('is idempotent when txnId already posted', async () => {
    txnFindFirst.mockResolvedValue({ id: 'existing' });
    await postTxn({ refType: 'booking', refId: 'b1', txnId: 'fixed', legs: [leg('DEBIT', 100n), leg('CREDIT', 100n)] });
    expect(entryCreate).not.toHaveBeenCalled();
  });

  it('returns the provided txnId', async () => {
    txnFindFirst.mockResolvedValue(null);
    const id = await postTxn({ refType: 'x', refId: 'y', txnId: 'abc', legs: [leg('DEBIT', 1n), leg('CREDIT', 1n)] });
    expect(id).toBe('abc');
  });
});

describe('balanceOf', () => {
  beforeEach(() => {
    redisGet.mockReset();
    redisSet.mockReset().mockResolvedValue('OK');
    acctFindFirstTop.mockReset();
    entryGroupBy.mockReset();
  });

  it('returns cached balance when present', async () => {
    redisGet.mockResolvedValue('500');
    expect(await balanceOf('CUSTOMER_WALLET', 'u1')).toBe(500n);
  });

  it('computes credit minus debit', async () => {
    redisGet.mockResolvedValue(null);
    acctFindFirstTop.mockResolvedValue({ id: 'acc-1' });
    entryGroupBy.mockResolvedValue([
      { direction: 'CREDIT', _sum: { amountPaise: 1000n } },
      { direction: 'DEBIT', _sum: { amountPaise: 300n } },
    ]);
    expect(await balanceOf('CUSTOMER_WALLET', 'u1')).toBe(700n);
  });

  it('returns 0 when no account exists', async () => {
    redisGet.mockResolvedValue(null);
    acctFindFirstTop.mockResolvedValue(null);
    expect(await balanceOf('CUSTOMER_WALLET', 'missing')).toBe(0n);
  });
});

describe('reconcile', () => {
  beforeEach(() => entryGroupBy.mockReset());
  it('reports zero drift when balanced', async () => {
    entryGroupBy.mockResolvedValue([
      { direction: 'CREDIT', _sum: { amountPaise: 1000n } },
      { direction: 'DEBIT', _sum: { amountPaise: 1000n } },
    ]);
    expect((await reconcile()).drift).toBe(0n);
  });
  it('detects drift', async () => {
    entryGroupBy.mockResolvedValue([
      { direction: 'CREDIT', _sum: { amountPaise: 1000n } },
      { direction: 'DEBIT', _sum: { amountPaise: 1100n } },
    ]);
    expect((await reconcile()).drift).toBe(100n);
  });
});

describe('transfer', () => {
  beforeEach(() => {
    txnFindFirst.mockReset().mockResolvedValue(null);
    entryCreate.mockReset().mockResolvedValue({});
    acctFindFirst.mockReset().mockResolvedValue({ id: 'acc-1' });
    redisDel.mockReset().mockResolvedValue(1);
  });
  it('posts a balanced two-leg transfer', async () => {
    await transfer({
      from: { type: 'PROMO_LIABILITY', ownerId: null },
      to: { type: 'CUSTOMER_WALLET', ownerId: 'u1' },
      amountPaise: 10_000n,
      refType: 'referral',
      refId: 'r1',
    });
    expect(entryCreate).toHaveBeenCalledTimes(2);
  });
});
