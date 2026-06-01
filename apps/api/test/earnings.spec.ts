import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  postTxn: vi.fn(),
  balanceOf: vi.fn(),
  bookingFindMany: vi.fn(),
  planFindFirst: vi.fn(),
  collFindMany: vi.fn(),
  payoutFindUnique: vi.fn(),
  payoutCreate: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    booking: { findMany: h.bookingFindMany },
    emiPlan: { findFirst: h.planFindFirst },
    emiCollection: { findMany: h.collFindMany },
    payout: { findUnique: h.payoutFindUnique, create: h.payoutCreate },
  },
}));
vi.mock('../src/modules/ledger/ledger.js', () => ({
  postTxn: (...a: unknown[]) => h.postTxn(...a),
  balanceOf: (...a: unknown[]) => h.balanceOf(...a),
}));
vi.mock('../src/env.js', () => ({ env: { DEFAULT_COMMISSION_RATE: 0.15 } }));

import { computeNet, recordTripEarning } from '../src/modules/earnings/earnings.service.js';
import { recordPayout } from '../src/modules/earnings/payouts.service.js';

describe('computeNet (pure)', () => {
  it('subtracts commission', () => {
    const r = computeNet({ grossPaise: 100_000n, commissionRate: 0.15 });
    expect(r.commissionCutPaise).toBe(15_000n);
    expect(r.netPaise).toBe(85_000n);
  });
  it('subtracts emi and adds incentives', () => {
    const r = computeNet({ grossPaise: 100_000n, commissionRate: 0.15, emiCutPaise: 5_000n, incentivesPaise: 2_000n });
    expect(r.netPaise).toBe(82_000n);
  });
  it('rounds commission to nearest paise', () => {
    const r = computeNet({ grossPaise: 33_333n, commissionRate: 0.15 });
    expect(r.commissionCutPaise).toBe(5_000n); // 4999.95 → 5000
  });
});

describe('recordTripEarning', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));
  it('posts balanced platform/revenue/payable legs', async () => {
    h.postTxn.mockResolvedValue('txn');
    await recordTripEarning({ bookingId: 'b1', driverId: 'd1', grossPaise: 100_000n });
    const arg = h.postTxn.mock.calls[0]![0] as { legs: Array<{ account: { type: string }; direction: string; amountPaise: bigint }> };
    const debit = arg.legs.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amountPaise, 0n);
    const credit = arg.legs.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amountPaise, 0n);
    expect(debit).toBe(credit);
    expect(debit).toBe(100_000n);
  });
  it('posts a second incentive txn when present', async () => {
    h.postTxn.mockResolvedValue('txn');
    await recordTripEarning({ bookingId: 'b1', driverId: 'd1', grossPaise: 100_000n, incentivesPaise: 2_000n });
    expect(h.postTxn).toHaveBeenCalledTimes(2);
  });
});

describe('recordPayout', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));
  const base = {
    driverId: 'd1',
    method: 'UPI',
    reference: 'PAYOUT-1',
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-01-07'),
    createdById: 'admin1',
  };

  it('rejects non-positive amounts', async () => {
    await expect(recordPayout({ ...base, amountPaise: 0n })).rejects.toThrow();
  });

  it('is idempotent on reference', async () => {
    h.payoutFindUnique.mockResolvedValue({ id: 'po-1' });
    const r = await recordPayout({ ...base, amountPaise: 50_000n });
    expect(r).toEqual({ id: 'po-1', created: false });
    expect(h.postTxn).not.toHaveBeenCalled();
  });

  it('rejects amount exceeding payable', async () => {
    h.payoutFindUnique.mockResolvedValue(null);
    h.balanceOf.mockResolvedValue(10_000n);
    await expect(recordPayout({ ...base, amountPaise: 50_000n })).rejects.toThrow();
  });

  it('posts the ledger and creates the payout', async () => {
    h.payoutFindUnique.mockResolvedValue(null);
    h.balanceOf.mockResolvedValue(100_000n);
    h.postTxn.mockResolvedValue('txn');
    h.payoutCreate.mockResolvedValue({ id: 'po-new' });
    const r = await recordPayout({ ...base, amountPaise: 50_000n });
    expect(r).toEqual({ id: 'po-new', created: true });
    const arg = h.postTxn.mock.calls[0]![0] as { legs: Array<{ direction: string; amountPaise: bigint }> };
    const debit = arg.legs.filter((l) => l.direction === 'DEBIT').reduce((s, l) => s + l.amountPaise, 0n);
    const credit = arg.legs.filter((l) => l.direction === 'CREDIT').reduce((s, l) => s + l.amountPaise, 0n);
    expect(debit).toBe(credit);
  });
});
