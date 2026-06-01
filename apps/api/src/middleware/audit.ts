import { getMongo } from '../mongo.js';
import { logger } from '../logger.js';
import type { AdminRequest } from './admin-session.js';

export interface AuditEntity {
  type: string;
  id: string;
  code?: string;
}

export interface AuditOpts {
  req: AdminRequest;
  action: string;
  entity: AuditEntity;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/**
 * Writes exactly one document to the Mongo `audit_events` collection per
 * state-changing admin action (Phase 3 §5.2 / §7.5). Every admin write handler
 * MUST call this once after a successful mutation.
 */
export async function audit(opts: AuditOpts): Promise<void> {
  const db = getMongo();
  const admin = opts.req.admin;
  if (!db || !admin) {
    logger.warn({ action: opts.action }, 'audit skipped: missing mongo or admin context');
    return;
  }
  await db.collection('audit_events').insertOne({
    ts: new Date(),
    actor: { id: admin.id, email: admin.email, role: admin.role, ip: admin.ip },
    action: opts.action,
    entity: opts.entity,
    before: opts.before ?? null,
    after: opts.after ?? null,
    reason: opts.reason ?? null,
    requestId: (opts.req as { id?: string }).id ?? null,
  });
}

/**
 * Writes a system/driver-initiated audit event (no admin request context).
 * Used by Phase 4 assignment automation and the driver portal where the actor
 * is the platform itself or a driver, not an admin user.
 */
export async function systemAudit(opts: {
  action: string;
  entity: AuditEntity;
  actor?: { id: string; role: string };
  before?: unknown;
  after?: unknown;
  reason?: string;
}): Promise<void> {
  const db = getMongo();
  if (!db) return;
  await db.collection('audit_events').insertOne({
    ts: new Date(),
    actor: opts.actor ? { id: opts.actor.id, role: opts.actor.role } : { id: 'system', role: 'SYSTEM' },
    action: opts.action,
    entity: opts.entity,
    before: opts.before ?? null,
    after: opts.after ?? null,
    reason: opts.reason ?? null,
  });
}

/** Cursor-paginated read over audit_events for the admin audit viewer. */
export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  cursor?: string; // ISO timestamp; returns events strictly older than this
  limit: number;
}

export async function readAuditEvents(q: AuditQuery): Promise<{ items: unknown[]; nextCursor: string | null }> {
  const db = getMongo();
  if (!db) return { items: [], nextCursor: null };

  const filter: Record<string, unknown> = {};
  if (q.entityType) filter['entity.type'] = q.entityType;
  if (q.entityId) filter['entity.id'] = q.entityId;
  if (q.actorId) filter['actor.id'] = q.actorId;
  if (q.action) filter.action = q.action;
  const ts: Record<string, Date> = {};
  if (q.from) ts.$gte = q.from;
  if (q.to) ts.$lte = q.to;
  if (q.cursor) ts.$lt = new Date(q.cursor);
  if (Object.keys(ts).length) filter.ts = ts;

  const items = await db
    .collection('audit_events')
    .find(filter)
    .sort({ ts: -1 })
    .limit(q.limit + 1)
    .toArray();

  let nextCursor: string | null = null;
  if (items.length > q.limit) {
    const last = items[q.limit - 1] as unknown as { ts: Date };
    nextCursor = last.ts.toISOString();
    items.length = q.limit;
  }
  return { items, nextCursor };
}
