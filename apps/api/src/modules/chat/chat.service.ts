import type { Collection } from 'mongodb';
import { getMongo, connectMongo } from '../../mongo.js';
import { prisma } from '../../prisma.js';
import { env } from '../../env.js';
import { Errors } from '../../errors.js';

export type ChatRole = 'PASSENGER' | 'DRIVER';

export interface ChatMessage {
  bookingId: string;
  fromRole: ChatRole;
  fromId: string;
  text: string;
  ts: Date;
  readAt: Date | null;
}

/** Booking statuses during which chat is writable. */
const CHAT_OPEN_STATUSES = new Set(['DRIVER_ASSIGNED', 'EN_ROUTE', 'ONGOING']);

/**
 * PURE: chat is writable while the trip is live (DRIVER_ASSIGNED..ONGOING) and
 * for `readonlyAfterHours` after COMPLETED it becomes read-only, then closed.
 */
export function chatWindow(
  status: string,
  completedAt: Date | null,
  now: Date,
  readonlyAfterHours: number,
): 'open' | 'readonly' | 'closed' {
  if (CHAT_OPEN_STATUSES.has(status)) return 'open';
  if (status === 'COMPLETED') {
    if (!completedAt) return 'readonly';
    const ageMs = now.getTime() - completedAt.getTime();
    return ageMs <= readonlyAfterHours * 3_600_000 ? 'readonly' : 'closed';
  }
  return 'closed';
}

async function collection(): Promise<Collection<ChatMessage>> {
  const db = getMongo() ?? (await connectMongo());
  return db.collection<ChatMessage>('chat_messages');
}

/** Create the indexes for chat_messages (called at boot when chat is enabled). */
export async function ensureChatIndexes(): Promise<void> {
  const col = await collection();
  await col.createIndex({ bookingId: 1, ts: 1 });
}

interface ChatBooking {
  id: string;
  userId: string;
  driverId: string | null;
  status: string;
  completedAt: Date | null;
}

/**
 * Validate that `actorId` (in role `role`) is a party on the booking and that
 * chat is currently OPEN for writing. Returns the booking + the recipient party
 * so the caller can fan out + push. Throws AppError otherwise.
 */
export async function assertCanSend(
  bookingId: string,
  role: ChatRole,
  actorId: string,
): Promise<{ booking: ChatBooking; toUserId: string | null; toDriverId: string | null }> {
  const booking = (await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, userId: true, driverId: true, status: true, completedAt: true },
  })) as ChatBooking | null;

  if (!booking) throw Errors.notFound('Booking not found');

  if (role === 'PASSENGER' && booking.userId !== actorId) throw Errors.forbidden('Not your booking');
  if (role === 'DRIVER' && booking.driverId !== actorId) throw Errors.forbidden('Not your trip');

  const window = chatWindow(booking.status, booking.completedAt, new Date(), env.CHAT_READONLY_AFTER_HOURS);
  if (window !== 'open') throw Errors.conflict('Chat is not open for this booking');

  return {
    booking,
    toUserId: role === 'DRIVER' ? booking.userId : null,
    toDriverId: role === 'PASSENGER' ? booking.driverId : null,
  };
}

/** Persist a chat message to Mongo and return the stored document. */
export async function saveMessage(input: {
  bookingId: string;
  fromRole: ChatRole;
  fromId: string;
  text: string;
}): Promise<ChatMessage> {
  const doc: ChatMessage = {
    bookingId: input.bookingId,
    fromRole: input.fromRole,
    fromId: input.fromId,
    text: input.text.slice(0, env.CHAT_MAX_LEN),
    ts: new Date(),
    readAt: null,
  };
  const col = await collection();
  await col.insertOne(doc);
  return doc;
}

/** List the message history for a booking (oldest first, capped). */
export async function listMessages(bookingId: string, limit = 200): Promise<ChatMessage[]> {
  const col = await collection();
  return col.find({ bookingId }).sort({ ts: 1 }).limit(limit).toArray();
}

/** Mark all messages from the OTHER party as read (recipient opened the thread). */
export async function markRead(bookingId: string, readerRole: ChatRole): Promise<void> {
  const otherRole: ChatRole = readerRole === 'PASSENGER' ? 'DRIVER' : 'PASSENGER';
  const col = await collection();
  await col.updateMany(
    { bookingId, fromRole: otherRole, readAt: null },
    { $set: { readAt: new Date() } },
  );
}

/** Read-only history access check (either party on the booking). */
export async function assertCanRead(bookingId: string, role: ChatRole, actorId: string): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { userId: true, driverId: true },
  });
  if (!booking) throw Errors.notFound('Booking not found');
  if (role === 'PASSENGER' && booking.userId !== actorId) throw Errors.forbidden('Not your booking');
  if (role === 'DRIVER' && booking.driverId !== actorId) throw Errors.forbidden('Not your trip');
}
