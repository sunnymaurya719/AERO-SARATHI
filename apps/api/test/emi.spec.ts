import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  planFindFirst: vi.fn(),
  planFindUnique: vi.fn(),
  planUpdate: vi.fn(),
  collCreate: vi.fn(),
  collFindMany: vi.fn(),
  balanceOf: vi.fn(),
  postTxn: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    emiPlan: { findFirst: h.planFindFirst, findUnique: h.planFindUnique, update: h.planUpdate },
    emiCollection: { create: h.collCreate, findMany: h.collFindMany },
  },
}));
vi.mock('../src/modules/ledger/ledger.js', () => ({
  balanceOf: (...a: unknown[]) => h.balanceOf(...a),
  postTxn: (...a: unknown[]) => h.postTxn(...a),
}));

import { computeCut, planStatusAfter, arrears, applyPerTripCut } from '../src/modules/emi/emi.service.js';

describe('computeCut (pure)', () => {
  it('takes the per-trip cut when funds and due allow', () => {
    expect(computeCut(5_000n, 100_000n, 50_000n)).toBe(5_000n);
  });
  it('is capped by remaining due', () => {
    expect(computeCut(5_000n, 3_000n, 50_000n)).toBe(3_000n);
  });
  it('is capped by available payable (never negative payable)', () => {
    expect(computeCut(5_000n, 100_000n, 2_000n)).toBe(2_000n);
  });
  it('clamps to zero when payable is negative', () => {
    expect(computeCut(5_000n, 100_000n, -100n)).toBe(0n);
  });
});

describe('planStatusAfter (pure)', () => {
  it('completes when collected reaches due', () => {
    expect(planStatusAfter(100_000n, 100_000n)).toBe('COMPLETED');
  });
  it('stays active below due', () => {
    expect(planStatusAfter(50_000n, 100_000n)).toBe('ACTIVE');
  });
});

describe('arrears (pure)', () => {
  it('is zero when on target', () => {
    expect(arrears(10_000n, 10_000n)).toBe(0n);
    expect(arrears(10_000n, 12_000n)).toBe(0n);
  });
  it('reports the shortfall', () => {
    expect(arrears(10_000n, 4_000n)).toBe(6_000n);
  });
  it('is zero when no weekly target', () => {
    expect(arrears(null, 0n)).toBe(0n);
  });
});

describe('applyPerTripCut', () => {
  beforeEach(() => Object.values(h).forEach((f) => f.mockReset()));

  it('returns 0 when there is no active plan', async () => {
    h.planFindFirst.mockResolvedValue(null);
    expect(await applyPerTripCut({ driverId: 'd1', bookingId: 'b1' })).toBe(0n);
    expect(h.postTxn).not.toHaveBeenCalled();
  });

  it('completes the plan and skips when already fully paid', async () => {
    h.planFindFirst.mockResolvedValue({ id: 'p1', perTripCutPaise: 5_000n, totalDuePaise: 100_000n, collectedPaise: 100_000n });
    expect(await applyPerTripCut({ driverId: 'd1', bookingId: 'b1' })).toBe(0n);
    expect(h.planUpdate).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'COMPLETED' } });
  });

  it('retains the cut, writes a collection and updates collected', async () => {
    h.planFindFirst.mockResolvedValue({ id: 'p1', perTripCutPaise: 5_000n, totalDuePaise: 100_000n, collectedPaise: 0n });
    h.balanceOf.mockResolvedValue(50_000n);
    h.postTxn.mockResolvedValue('txn');
    const cut = await applyPerTripCut({ driverId: 'd1', bookingId: 'b1' });
    expect(cut).toBe(5_000n);
    expect(h.collCreate).toHaveBeenCalledOnce();
    expect(h.postTxn).toHaveBeenCalledOnce();
    const update = h.planUpdate.mock.calls.at(-1)?.[0] as { data: { collectedPaise: bigint; status: string } };
    expect(update.data.collectedPaise).toBe(5_000n);
    expect(update.data.status).toBe('ACTIVE');
  });

  it('skips when driver payable is exhausted', async () => {
    h.planFindFirst.mockResolvedValue({ id: 'p1', perTripCutPaise: 5_000n, totalDuePaise: 100_000n, collectedPaise: 0n });
    h.balanceOf.mockResolvedValue(0n);
    expect(await applyPerTripCut({ driverId: 'd1', bookingId: 'b1' })).toBe(0n);
    expect(h.postTxn).not.toHaveBeenCalled();
  });
});
