import { Prisma } from '@aero/db';
import type { AlertStatus } from '@aero/db';
import { prisma } from '../../prisma.js';
import type { SystemAlertRow } from '@aero/types';

function toRow(a: {
  id: string;
  type: string;
  severity: string;
  status: string;
  entityType: string | null;
  entityId: string | null;
  payload: unknown;
  ackedById: string | null;
  ackedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
}): SystemAlertRow {
  return {
    id: a.id,
    type: a.type as SystemAlertRow['type'],
    severity: a.severity as SystemAlertRow['severity'],
    status: a.status as SystemAlertRow['status'],
    entityType: a.entityType,
    entityId: a.entityId,
    payload: (a.payload ?? {}) as Record<string, unknown>,
    ackedById: a.ackedById,
    ackedAt: a.ackedAt?.toISOString() ?? null,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function listAlerts(filters: { status?: AlertStatus; limit: number }): Promise<SystemAlertRow[]> {
  const where: Prisma.SystemAlertWhereInput = {};
  if (filters.status) where.status = filters.status;
  const rows = await prisma.systemAlert.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filters.limit,
  });
  return rows.map(toRow);
}

export async function ackAlert(id: string, adminId: string): Promise<SystemAlertRow> {
  const row = await prisma.systemAlert.update({
    where: { id },
    data: { status: 'ACKED', ackedById: adminId, ackedAt: new Date() },
  });
  return toRow(row);
}

export async function resolveAlert(id: string): Promise<SystemAlertRow> {
  const row = await prisma.systemAlert.update({
    where: { id },
    data: { status: 'RESOLVED', resolvedAt: new Date() },
  });
  return toRow(row);
}

/** Open-alert count grouped by type (for the admin dashboard tray). */
export async function openAlertCounts(): Promise<{ type: string; count: number }[]> {
  const grouped = await prisma.systemAlert.groupBy({
    by: ['type'],
    where: { status: 'OPEN' },
    _count: { _all: true },
  });
  return grouped.map((g) => ({ type: g.type, count: g._count._all }));
}
