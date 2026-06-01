import { Server as IOServer } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { prisma } from '../prisma.js';
import { verifyTrackToken } from '../modules/tracking/track-token.js';
import { ingestPing, recordPingMetric } from './location-ingest.js';
import type { PublicLocation, EtaUpdate, TrackStage } from '@aero/types';
import {
  assertCanSend,
  assertCanRead,
  saveMessage,
  markRead,
  type ChatRole,
} from '../modules/chat/chat.service.js';
import { sendCustomerPush, sendOfferPush } from '../integrations/fcm.js';

/**
 * Socket.io server (Phase 4 `/driver` + Phase 5 `/passenger`, `/track`, `/admin`).
 *
 * - `/driver` (auth: DRIVER JWT): receives `location:ping`, pushes offers.
 * - `/passenger` (auth: customer JWT cookie/bearer): joins `booking:{id}` after
 *   ownership check; receives trimmed `loc` / `eta` / `booking:status`.
 * - `/track` (public, HMAC token in handshake): read-only; joins `track:{code}`.
 * - `/admin` (auth: ADMIN/OPS JWT): live ops map + SOS console fanout.
 */

let io: IOServer | null = null;

export function getIo(): IOServer | null {
  return io;
}

export function initRealtime(server: HttpServer): IOServer {
  io = new IOServer(server, {
    path: env.SOCKET_IO_PATH,
    cors: {
      origin: [...env.DRIVER_CORS_ORIGINS, ...env.CORS_ORIGINS, ...env.ADMIN_CORS_ORIGINS],
      credentials: true,
    },
    serveClient: false,
  });

  setupDriverNamespace(io);
  setupPassengerNamespace(io);
  setupTrackNamespace(io);
  setupAdminNamespace(io);

  logger.info({ path: env.SOCKET_IO_PATH }, 'realtime_initialised');
  return io;
}

// ── /driver ────────────────────────────────────────────────────────────────

function setupDriverNamespace(server: IOServer): void {
  const driverNs = server.of('/driver');

  driverNs.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      const claims = await verifyAccessToken(token);
      if (claims.role !== 'DRIVER') return next(new Error('forbidden'));
      // The JWT sub is the User id; we resolve the Driver id lazily on join.
      socket.data.userId = claims.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  driverNs.on('connection', (socket) => {
    const driverId = socket.handshake.auth?.driverId as string | undefined;
    if (driverId) {
      void socket.join(driverRoom(driverId));
      socket.data.driverId = driverId;
    }
    logger.debug({ userId: socket.data.userId, driverId }, 'driver_socket_connected');

    socket.on('join', (id: string) => {
      if (typeof id === 'string' && id) {
        void socket.join(driverRoom(id));
        socket.data.driverId = id;
      }
    });

    // Phase 5: high-frequency GPS ingest.
    socket.on('location:ping', (raw: unknown) => {
      void handleLocationPing(socket.data.driverId as string | undefined, raw);
    });

    socket.on('chat:message', (payload: unknown) => {
      void handleChatMessage('DRIVER', socket.data.driverId as string | undefined, payload);
    });
    socket.on('chat:read', (bookingId: unknown) => {
      if (typeof bookingId === 'string' && bookingId) void markChatRead('DRIVER', socket.data.driverId as string | undefined, bookingId);
    });

    socket.on('disconnect', () => {
      logger.debug({ driverId: socket.data.driverId }, 'driver_socket_disconnected');
    });
  });
}

async function handleLocationPing(driverId: string | undefined, raw: unknown): Promise<void> {
  if (!driverId || !env.TRACKING_ENABLED) return;
  const result = await ingestPing(driverId, raw);
  await recordPingMetric(result.ok ? 'accepted' : result.reason);
  if (!result.ok) return;
  await fanoutLocation(result.bookingId, result.public);
}

/**
 * Validate + persist + fan out an in-trip chat message, with a push fallback to
 * the recipient. Errors are swallowed (best-effort over a volatile socket); the
 * REST history endpoint is the durable read path.
 */
async function handleChatMessage(role: ChatRole, actorId: string | undefined, payload: unknown): Promise<void> {
  if (!env.CHAT_ENABLED || !actorId) return;
  const body = payload as { bookingId?: unknown; text?: unknown } | null;
  const bookingId = typeof body?.bookingId === 'string' ? body.bookingId : '';
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!bookingId || !text) return;

  try {
    const { booking, toUserId, toDriverId } = await assertCanSend(bookingId, role, actorId);
    const msg = await saveMessage({ bookingId, fromRole: role, fromId: actorId, text });
    fanoutChat(bookingId, booking.driverId, msg);

    // Push fallback to whoever is the recipient.
    if (toUserId) {
      void sendCustomerPush(toUserId, { title: 'New message from your driver', body: msg.text.slice(0, 120) }, {
        type: 'chat',
        bookingId,
      });
    }
    if (toDriverId) {
      void sendOfferPush(toDriverId, { type: 'chat', code: booking.id, deepLink: `aerosarathi://bookings/${bookingId}` });
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, role, bookingId }, 'chat_message_rejected');
  }
}

async function markChatRead(role: ChatRole, actorId: string | undefined, bookingId: string): Promise<void> {
  if (!env.CHAT_ENABLED || !actorId) return;
  try {
    await assertCanRead(bookingId, role, actorId);
    await markRead(bookingId, role);
  } catch (err) {
    logger.warn({ err: (err as Error).message, role, bookingId }, 'chat_read_rejected');
  }
}

// ── /passenger ───────────────────────────────────────────────────────────

function setupPassengerNamespace(server: IOServer): void {
  const ns = server.of('/passenger');

  ns.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        readCookie(socket.handshake.headers.cookie, '__Host-aero_at');
      if (!token) return next(new Error('unauthorized'));
      const claims = await verifyAccessToken(token);
      socket.data.userId = claims.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  ns.on('connection', (socket) => {
    socket.on('join', async (bookingId: string) => {
      if (typeof bookingId !== 'string' || !bookingId) return;
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { userId: true },
      });
      if (!booking || booking.userId !== socket.data.userId) {
        socket.emit('error', { reason: 'forbidden' });
        return;
      }
      void socket.join(bookingRoom(bookingId));
    });

    socket.on('chat:message', (payload: unknown) => {
      void handleChatMessage('PASSENGER', socket.data.userId as string | undefined, payload);
    });
    socket.on('chat:read', (bookingId: unknown) => {
      if (typeof bookingId === 'string' && bookingId) void markChatRead('PASSENGER', socket.data.userId as string | undefined, bookingId);
    });
  });
}

// ── /track (public) ────────────────────────────────────────────────────────

function setupTrackNamespace(server: IOServer): void {
  const ns = server.of('/track');

  ns.use(async (socket, next) => {
    try {
      if (!env.TRACKING_ENABLED) return next(new Error('disabled'));
      const code = socket.handshake.query?.code as string | undefined;
      const token = socket.handshake.query?.t as string | undefined;
      if (!code || !token) return next(new Error('unauthorized'));
      const bookingId = await verifyTrackToken(token);
      if (!bookingId) return next(new Error('unauthorized'));
      const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { code: true } });
      if (!booking || booking.code !== code) return next(new Error('unauthorized'));
      socket.data.code = code;
      socket.data.bookingId = bookingId;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  ns.on('connection', (socket) => {
    const code = socket.data.code as string;
    void socket.join(trackRoom(code));
    // Read-only namespace: log + ignore any client-emitted events.
    socket.onAny((event: string) => {
      logger.warn({ event, code }, 'track_client_event_rejected');
    });
  });
}

// ── /admin ──────────────────────────────────────────────────────────────────

function setupAdminNamespace(server: IOServer): void {
  const ns = server.of('/admin');
  ns.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('unauthorized'));
      const claims = await verifyAccessToken(token);
      if (claims.role !== 'ADMIN' && claims.role !== 'OPS') return next(new Error('forbidden'));
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  ns.on('connection', (socket) => {
    socket.on('join', (room: string) => {
      if (room === 'live' || room === 'sos') void socket.join(room);
    });
  });
}

// ── Fanout helpers ──────────────────────────────────────────────────────────

export async function fanoutLocation(bookingId: string, loc: PublicLocation): Promise<void> {
  if (!io) return;
  io.of('/passenger').to(bookingRoom(bookingId)).emit('loc', loc);
  const code = await codeForBooking(bookingId);
  if (code) io.of('/track').to(trackRoom(code)).emit('loc', loc);
  io.of('/admin').to('live').emit('live:loc', { bookingId, location: loc });
}

export async function fanoutEta(bookingId: string, eta: EtaUpdate): Promise<void> {
  if (!io) return;
  io.of('/passenger').to(bookingRoom(bookingId)).emit('eta', eta);
  const code = await codeForBooking(bookingId);
  if (code) io.of('/track').to(trackRoom(code)).emit('eta', eta);
}

export async function fanoutStatus(bookingId: string, stage: TrackStage, status: string): Promise<void> {
  if (!io) return;
  const payload = { stage, status };
  io.of('/passenger').to(bookingRoom(bookingId)).emit('booking:status', payload);
  const code = await codeForBooking(bookingId);
  if (code) io.of('/track').to(trackRoom(code)).emit('booking:status', payload);
  io.of('/admin').to('live').emit('live:status', { bookingId, ...payload });
}

export function emitSosToAdmin(payload: unknown): void {
  io?.of('/admin').to('sos').emit('sos:new', payload);
}

export async function emitSosToTrack(bookingId: string, payload: unknown): Promise<void> {
  if (!io) return;
  const code = await codeForBooking(bookingId);
  if (code) io.of('/track').to(trackRoom(code)).emit('sos:ack', payload);
}

const codeCache = new Map<string, string>();
async function codeForBooking(bookingId: string): Promise<string | null> {
  const cached = codeCache.get(bookingId);
  if (cached) return cached;
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { code: true } });
  if (b?.code) {
    codeCache.set(bookingId, b.code);
    return b.code;
  }
  return null;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function driverRoom(driverId: string): string {
  return `driver:${driverId}`;
}
export function bookingRoom(bookingId: string): string {
  return `booking:${bookingId}`;
}
export function trackRoom(code: string): string {
  return `track:${code}`;
}

/** Emit an event to a driver's room (no-op if realtime not initialised). */
export function emitToDriver(driverId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.of('/driver').to(driverRoom(driverId)).emit(event, payload);
}

/**
 * Fan a chat message out to both parties: the passenger's booking room and the
 * assigned driver's room. Either side may be offline (push fallback handles it).
 */
export function fanoutChat(bookingId: string, driverId: string | null, payload: unknown): void {
  if (!io) return;
  io.of('/passenger').to(bookingRoom(bookingId)).emit('chat:message', payload);
  if (driverId) io.of('/driver').to(driverRoom(driverId)).emit('chat:message', payload);
}

export async function closeRealtime(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
