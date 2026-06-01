import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  cityFindUnique: vi.fn(),
  cityCreate: vi.fn(),
  cityUpdate: vi.fn(),
  cityFindMany: vi.fn(),
  zoneCount: vi.fn(),
  zoneFindMany: vi.fn(),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
}));

vi.mock('../src/prisma.js', () => ({
  prisma: {
    city: {
      findUnique: h.cityFindUnique,
      create: h.cityCreate,
      update: h.cityUpdate,
      findMany: h.cityFindMany,
    },
    zone: {
      count: h.zoneCount,
      findMany: h.zoneFindMany,
    },
  },
}));

vi.mock('../src/redis.js', () => ({
  redis: {
    get: (...a: unknown[]) => h.redisGet(...a),
    set: (...a: unknown[]) => h.redisSet(...a),
    del: (...a: unknown[]) => h.redisDel(...a),
  },
}));

import {
  createCity,
  setCityStatus,
  resolveZoneForPoint,
  resolveCityForPoint,
} from '../src/modules/cities/cities.service.js';

const square = [
  [76.70, 30.70],
  [76.80, 30.70],
  [76.80, 30.80],
  [76.70, 30.80],
  [76.70, 30.70],
];

describe('createCity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uppercases the code and rejects duplicates', async () => {
    h.cityFindUnique.mockResolvedValue({ id: 'c1' });
    await expect(createCity({ code: 'ldh', name: 'Ludhiana', centerLat: 30.9, centerLng: 75.85 }))
      .rejects.toMatchObject({ status: 409 });
    expect(h.cityFindUnique).toHaveBeenCalledWith({ where: { code: 'LDH' } });
  });

  it('creates a PLANNED city', async () => {
    h.cityFindUnique.mockResolvedValue(null);
    h.cityCreate.mockResolvedValue({ id: 'c2', code: 'LDH' });
    const city = await createCity({ code: ' ldh ', name: 'Ludhiana', centerLat: 30.9, centerLng: 75.85 });
    expect(city.code).toBe('LDH');
    const arg = h.cityCreate.mock.calls[0]![0] as { data: { code: string; status: string } };
    expect(arg.data.code).toBe('LDH');
    expect(arg.data.status).toBe('PLANNED');
  });
});

describe('setCityStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses to go LIVE with zero zones', async () => {
    h.cityFindUnique.mockResolvedValue({ id: 'c1', status: 'PLANNED', launchedAt: null });
    h.zoneCount.mockResolvedValue(0);
    await expect(setCityStatus('c1', 'LIVE')).rejects.toMatchObject({ status: 400 });
  });

  it('launches when zones exist and stamps launchedAt', async () => {
    h.cityFindUnique.mockResolvedValue({ id: 'c1', status: 'PLANNED', launchedAt: null });
    h.zoneCount.mockResolvedValue(2);
    h.cityUpdate.mockResolvedValue({ id: 'c1', status: 'LIVE' });
    await setCityStatus('c1', 'LIVE');
    const arg = h.cityUpdate.mock.calls[0]![0] as { data: { status: string; launchedAt?: Date } };
    expect(arg.data.status).toBe('LIVE');
    expect(arg.data.launchedAt).toBeInstanceOf(Date);
  });
});

describe('resolveZoneForPoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the containing zone (cache miss → DB load)', async () => {
    h.redisGet.mockResolvedValue(null);
    h.zoneFindMany.mockResolvedValue([{ id: 'z1', code: 'SEC17', polygon: [square] }]);
    h.redisSet.mockResolvedValue('OK');
    const zone = await resolveZoneForPoint('c1', 30.75, 76.75);
    expect(zone).toEqual({ id: 'z1', code: 'SEC17' });
  });

  it('returns null when no zone contains the point', async () => {
    h.redisGet.mockResolvedValue(JSON.stringify([{ id: 'z1', code: 'SEC17', polygon: [square] }]));
    const zone = await resolveZoneForPoint('c1', 28.61, 77.20);
    expect(zone).toBeNull();
  });
});

describe('resolveCityForPoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the first live city whose zones contain the point', async () => {
    h.cityFindMany.mockResolvedValue([{ id: 'c1', code: 'CHD' }]);
    h.redisGet.mockResolvedValue(JSON.stringify([{ id: 'z1', code: 'SEC17', polygon: [square] }]));
    const hit = await resolveCityForPoint(30.75, 76.75);
    expect(hit).toEqual({ cityId: 'c1', cityCode: 'CHD', zoneCode: 'SEC17' });
  });

  it('returns null when no live city serves the point', async () => {
    h.cityFindMany.mockResolvedValue([{ id: 'c1', code: 'CHD' }]);
    h.redisGet.mockResolvedValue(JSON.stringify([{ id: 'z1', code: 'SEC17', polygon: [square] }]));
    const hit = await resolveCityForPoint(28.61, 77.20);
    expect(hit).toBeNull();
  });
});
