'use client';

import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './auth';

const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/api\/v1$/,
  '',
);
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH ?? '/realtime';

let socket: Socket | null = null;

/** Connect (once) to the driver realtime namespace with the bearer token. */
export function connectSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  const token = getAccessToken();
  if (!token) return null;
  if (socket?.connected) return socket;

  socket = io(`${API_ORIGIN}/driver`, {
    path: SOCKET_PATH,
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
