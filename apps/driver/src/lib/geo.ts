'use client';

import { connectSocket } from './socket';
import { api } from './api';

/**
 * Driver GPS publisher. Streams `location:ping` over the realtime socket every
 * ~5s while a trip is live, with a REST fallback when the socket is down.
 */

export interface GeoPing {
  lat: number;
  lng: number;
  accuracyM: number;
  headingDeg: number | null;
  speedKmh: number | null;
  ts: number; // epoch ms
  seq: number;
}

const PUBLISH_INTERVAL_MS = 5000;

export interface GeoPublisherHandle {
  stop: () => void;
}

/**
 * Begin watching position and publishing pings until `stop()` is called.
 * `onFix` lets the UI render the latest location.
 */
export function startGeoPublisher(onFix?: (p: GeoPing) => void): GeoPublisherHandle {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { stop: () => undefined };
  }

  let seq = 0;
  let latest: GeolocationPosition | null = null;
  let lastSentAt = 0;

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      latest = pos;
    },
    () => undefined,
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 },
  );

  const publish = async (): Promise<void> => {
    if (!latest) return;
    const now = Date.now();
    if (now - lastSentAt < PUBLISH_INTERVAL_MS - 250) return;
    lastSentAt = now;

    const c = latest.coords;
    const ping: GeoPing = {
      lat: c.latitude,
      lng: c.longitude,
      accuracyM: Math.round(c.accuracy ?? 9999),
      headingDeg: Number.isFinite(c.heading) ? Math.round(c.heading!) : null,
      speedKmh: Number.isFinite(c.speed) ? Math.round((c.speed ?? 0) * 3.6) : null,
      ts: now,
      seq: seq++,
    };
    onFix?.(ping);

    const socket = connectSocket();
    if (socket?.connected) {
      socket.volatile.emit('location:ping', ping);
    } else {
      // REST fallback (best-effort; ignore failures, next tick retries).
      try {
        await api('/trips/ping', { method: 'POST', body: ping });
      } catch {
        /* swallow */
      }
    }
  };

  const timer = window.setInterval(() => void publish(), PUBLISH_INTERVAL_MS);

  return {
    stop: () => {
      window.clearInterval(timer);
      navigator.geolocation.clearWatch(watchId);
    },
  };
}
