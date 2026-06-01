/**
 * Phase 8 — Workstream B: Multi-City service.
 *
 * Cities and their zones are the configuration that lets ops launch a new
 * region without a code deploy. A city is only bookable once `status = LIVE`.
 * Zone assignment for a lat/lng uses point-in-polygon over the city's zones,
 * cached in Redis (`city:zones:{cityId}`) to avoid hitting Postgres per lookup.
 */
import { Prisma } from '@aero/db';
import type { CityStatus } from '@aero/db';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { Errors } from '../../errors.js';
import { assignZone, isValidPolygon, type PolygonCoords, type ZoneShape } from './point-in-polygon.js';

const ZONES_CACHE_TTL_SEC = 300;
const zonesCacheKey = (cityId: string): string => `city:zones:${cityId}`;

export interface CityInput {
  code: string;
  name: string;
  timezone?: string;
  centerLat: number;
  centerLng: number;
}

export interface ZoneInput {
  code: string;
  name: string;
  polygon: PolygonCoords;
}

// ── Cities ────────────────────────────────────────────────────────────────

export async function listCities(): Promise<unknown[]> {
  return prisma.city.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { zones: true } } },
  });
}

export async function getCity(id: string): Promise<unknown> {
  const city = await prisma.city.findUnique({
    where: { id },
    include: { zones: { orderBy: { code: 'asc' } } },
  });
  if (!city) throw Errors.notFound('City not found');
  return city;
}

export async function createCity(input: CityInput): Promise<{ id: string; code: string }> {
  const code = input.code.trim().toUpperCase();
  const existing = await prisma.city.findUnique({ where: { code } });
  if (existing) throw Errors.conflict('A city with this code already exists');
  const city = await prisma.city.create({
    data: {
      code,
      name: input.name.trim(),
      timezone: input.timezone?.trim() || 'Asia/Kolkata',
      centerLat: input.centerLat,
      centerLng: input.centerLng,
      status: 'PLANNED',
    },
    select: { id: true, code: true },
  });
  return city;
}

export async function updateCity(
  id: string,
  patch: Partial<Pick<CityInput, 'name' | 'timezone' | 'centerLat' | 'centerLng'>>,
): Promise<unknown> {
  await ensureCity(id);
  return prisma.city.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone.trim() } : {}),
      ...(patch.centerLat !== undefined ? { centerLat: patch.centerLat } : {}),
      ...(patch.centerLng !== undefined ? { centerLng: patch.centerLng } : {}),
    },
  });
}

/**
 * Transition a city's lifecycle. Going LIVE requires at least one zone so the
 * city can actually assign rides; this is the headline "launch from config"
 * gate. PAUSED/PLANNED cities are never bookable.
 */
export async function setCityStatus(id: string, status: CityStatus): Promise<unknown> {
  const city = await ensureCity(id);
  if (status === 'LIVE' && city.status !== 'LIVE') {
    const zoneCount = await prisma.zone.count({ where: { cityId: id } });
    if (zoneCount === 0) {
      throw Errors.validation('Cannot launch a city with no zones; draw at least one zone first');
    }
  }
  return prisma.city.update({
    where: { id },
    data: {
      status,
      ...(status === 'LIVE' && !city.launchedAt ? { launchedAt: new Date() } : {}),
    },
  });
}

/** Public: cities that apps may show as bookable. */
export async function listLiveCities(): Promise<Array<{ code: string; name: string; centerLat: number; centerLng: number; timezone: string }>> {
  const cities = await prisma.city.findMany({
    where: { status: 'LIVE' },
    orderBy: { name: 'asc' },
    select: { code: true, name: true, centerLat: true, centerLng: true, timezone: true },
  });
  return cities;
}

// ── Zones ─────────────────────────────────────────────────────────────────

export async function listZones(cityId: string): Promise<unknown[]> {
  await ensureCity(cityId);
  return prisma.zone.findMany({ where: { cityId }, orderBy: { code: 'asc' } });
}

export async function upsertZone(cityId: string, input: ZoneInput): Promise<unknown> {
  await ensureCity(cityId);
  if (!isValidPolygon(input.polygon)) {
    throw Errors.validation('Invalid GeoJSON polygon: expected closed rings of [lng,lat] points');
  }
  const code = input.code.trim().toUpperCase();
  const zone = await prisma.zone.upsert({
    where: { cityId_code: { cityId, code } },
    create: {
      cityId,
      code,
      name: input.name.trim(),
      polygon: input.polygon as unknown as Prisma.InputJsonValue,
    },
    update: {
      name: input.name.trim(),
      polygon: input.polygon as unknown as Prisma.InputJsonValue,
    },
  });
  await invalidateZonesCache(cityId);
  return zone;
}

export async function deleteZone(cityId: string, zoneId: string): Promise<void> {
  const zone = await prisma.zone.findFirst({ where: { id: zoneId, cityId } });
  if (!zone) throw Errors.notFound('Zone not found');
  await prisma.zone.delete({ where: { id: zoneId } });
  await invalidateZonesCache(cityId);
}

// ── Zone assignment (cached point-in-polygon) ───────────────────────────────

async function loadZoneShapes(cityId: string): Promise<ZoneShape[]> {
  try {
    const cached = await redis.get(zonesCacheKey(cityId));
    if (cached) return JSON.parse(cached) as ZoneShape[];
  } catch (err) {
    logger.warn({ err, cityId }, 'zones_cache_read_failed');
  }
  const rows = await prisma.zone.findMany({
    where: { cityId },
    select: { id: true, code: true, polygon: true },
  });
  const shapes: ZoneShape[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    polygon: r.polygon as unknown as PolygonCoords,
  }));
  try {
    await redis.set(zonesCacheKey(cityId), JSON.stringify(shapes), 'EX', ZONES_CACHE_TTL_SEC);
  } catch (err) {
    logger.warn({ err, cityId }, 'zones_cache_write_failed');
  }
  return shapes;
}

async function invalidateZonesCache(cityId: string): Promise<void> {
  try {
    await redis.del(zonesCacheKey(cityId));
  } catch (err) {
    logger.warn({ err, cityId }, 'zones_cache_invalidate_failed');
  }
}

/** Resolve the zone (by code) that contains a point within a city, or null. */
export async function resolveZoneForPoint(cityId: string, lat: number, lng: number): Promise<{ id: string; code: string } | null> {
  const shapes = await loadZoneShapes(cityId);
  const hit = assignZone(lat, lng, shapes);
  return hit ? { id: hit.id, code: hit.code } : null;
}

/**
 * Resolve a point to a LIVE city by testing each live city's zones. Returns the
 * first city whose zones contain the point. Used to scope a new booking to a
 * city from pickup coordinates when multi-city is enabled.
 */
export async function resolveCityForPoint(lat: number, lng: number): Promise<{ cityId: string; cityCode: string; zoneCode: string } | null> {
  const live = await prisma.city.findMany({ where: { status: 'LIVE' }, select: { id: true, code: true } });
  for (const c of live) {
    const zone = await resolveZoneForPoint(c.id, lat, lng);
    if (zone) return { cityId: c.id, cityCode: c.code, zoneCode: zone.code };
  }
  return null;
}

/** Resolve the configured default city id (CHD), creating none. Used as the backfill scope. */
export async function defaultCityId(): Promise<string | null> {
  const city = await prisma.city.findUnique({ where: { code: env.DEFAULT_CITY_CODE }, select: { id: true } });
  return city?.id ?? null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function ensureCity(id: string): Promise<{ id: string; status: CityStatus; launchedAt: Date | null }> {
  const city = await prisma.city.findUnique({ where: { id }, select: { id: true, status: true, launchedAt: true } });
  if (!city) throw Errors.notFound('City not found');
  return city;
}
