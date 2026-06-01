/**
 * Notification centre web feed (Phase 6 §8.4). Reads the existing Notification
 * table (Phase 2) extended with web-feed fields (title/body/link/readAt).
 */
import { prisma } from '../../prisma.js';

export interface FeedItem {
  id: string;
  title: string | null;
  body: string | null;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** Cursor-paginated notification feed for a user. */
export async function listFeed(
  userId: string,
  cursor?: string,
  limit = 20,
): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(limit, 1), 50);
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, title: true, body: true, link: true, readAt: true, createdAt: true },
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

/** Count unread notifications. */
export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

/** Mark one notification read (scoped to the owner). */
export async function markRead(userId: string, id: string): Promise<void> {
  await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
}

/** Mark all of a user's notifications read. */
export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
