'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { MapPin, Phone, Clock, ShieldAlert, Share2, Car } from 'lucide-react';
import { loadGoogleMaps } from '@/lib/google-maps';
import type { TrackSnapshot, TrackRoute, PublicLocation, EtaUpdate, TrackStage } from '@aero/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
const API_ORIGIN = API_URL.replace(/\/api\/v1$/, '');
const SOCKET_PATH = process.env.NEXT_PUBLIC_SOCKET_PATH ?? '/realtime';

const STAGES: { key: TrackStage; label: string }[] = [
  { key: 'assigned', label: 'Driver assigned' },
  { key: 'en_route', label: 'On the way' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'ongoing', label: 'In ride' },
  { key: 'completed', label: 'Completed' },
];

export default function TrackPage() {
  const { code } = useParams<{ code: string }>();
  const token = useSearchParams().get('t') ?? '';

  const [snapshot, setSnapshot] = useState<TrackSnapshot | null>(null);
  const [location, setLocation] = useState<PublicLocation | null>(null);
  const [eta, setEta] = useState<EtaUpdate | null>(null);
  const [stage, setStage] = useState<TrackStage>('assigned');
  const [error, setError] = useState<string | null>(null);
  const [sosSent, setSosSent] = useState(false);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const gmapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);

  // Initial snapshot + route over REST (works even without a socket).
  useEffect(() => {
    if (!code || !token) {
      setError('This tracking link is invalid.');
      return;
    }
    const q = `?t=${encodeURIComponent(token)}`;
    fetch(`${API_URL}/tracking/${code}/snapshot${q}`)
      .then(async (r) => {
        if (!r.ok) throw new Error('expired');
        const s = (await r.json()) as TrackSnapshot;
        setSnapshot(s);
        setStage(s.stage);
        if (s.location) setLocation(s.location);
        if (s.eta) setEta(s.eta);
      })
      .catch(() => setError('This tracking link has expired or is invalid.'));
  }, [code, token]);

  // Live socket updates.
  useEffect(() => {
    if (!code || !token) return;
    const socket: Socket = io(`${API_ORIGIN}/track`, {
      path: SOCKET_PATH,
      query: { code, t: token },
      transports: ['websocket'],
      reconnection: true,
    });
    socket.on('loc', (p: PublicLocation) => setLocation(p));
    socket.on('eta', (e: EtaUpdate) => setEta(e));
    socket.on('booking:status', (s: { stage: TrackStage }) => setStage(s.stage));
    return () => {
      socket.disconnect();
    };
  }, [code, token]);

  // Map init + route polyline once snapshot is loaded.
  useEffect(() => {
    if (!snapshot || !mapRef.current) return;
    let cancelled = false;
    void loadGoogleMaps().then(async (g) => {
      if (!g || cancelled || !mapRef.current) return;
      const map = new g.maps.Map(mapRef.current, {
        center: { lat: snapshot.pickup.lat, lng: snapshot.pickup.lng },
        zoom: 12,
        disableDefaultUI: true,
        zoomControl: true,
      });
      gmapRef.current = map;
      new g.maps.Marker({ position: snapshot.pickup, map, label: 'P' });
      new g.maps.Marker({ position: snapshot.drop, map, label: 'D' });

      const r = await fetch(`${API_URL}/tracking/${code}/route?t=${encodeURIComponent(token)}`).catch(() => null);
      if (r?.ok) {
        const route = (await r.json()) as TrackRoute;
        const path = g.maps.geometry.encoding.decodePath(route.polyline);
        new g.maps.Polyline({ path, map, strokeColor: '#f48024', strokeWeight: 4, strokeOpacity: 0.8 });
        const bounds = new g.maps.LatLngBounds();
        path.forEach((pt) => bounds.extend(pt));
        if (!bounds.isEmpty()) map.fitBounds(bounds);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot, code, token]);

  // Smoothly move the driver marker as locations stream in.
  useEffect(() => {
    if (!location || !gmapRef.current) return;
    const g = window.google;
    if (!g) return;
    const pos = { lat: location.lat, lng: location.lng };
    if (!markerRef.current) {
      markerRef.current = new g.maps.Marker({
        position: pos,
        map: gmapRef.current,
        icon: {
          path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 5,
          fillColor: '#1e2d5a',
          fillOpacity: 1,
          strokeWeight: 1,
          rotation: location.headingDeg ?? 0,
        },
      });
    } else {
      markerRef.current.setPosition(pos);
      const icon = markerRef.current.getIcon() as google.maps.Symbol;
      markerRef.current.setIcon({ ...icon, rotation: location.headingDeg ?? 0 });
    }
    gmapRef.current.panTo(pos);
  }, [location]);

  async function triggerSos(): Promise<void> {
    if (sosSent) return;
    try {
      const body: { lat?: number; lng?: number } = {};
      if (location) {
        body.lat = location.lat;
        body.lng = location.lng;
      }
      const r = await fetch(`${API_URL}/tracking/${code}/sos?t=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (r.ok) setSosSent(true);
    } catch {
      /* ignore — user can retry */
    }
  }

  async function share(): Promise<void> {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: 'Track my ride', url }).catch(() => undefined);
    } else {
      await navigator.clipboard.writeText(url).catch(() => undefined);
    }
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="rounded-xl border border-sand-200 bg-white p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 text-sand-400" size={32} />
          <p className="text-sand-600">{error}</p>
        </div>
      </main>
    );
  }

  const stageIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col bg-sand-50">
      <header className="flex items-center justify-between px-4 py-3">
        <span className="text-lg font-bold tracking-wide text-brand-orange">AERO SARATHI</span>
        <button onClick={() => void share()} className="flex items-center gap-1 text-sm text-sand-500">
          <Share2 size={16} /> Share
        </button>
      </header>

      <div ref={mapRef} className="h-72 w-full bg-sand-200" />

      <section className="flex-1 space-y-4 rounded-t-2xl bg-white p-4 shadow-inner">
        {/* Status timeline */}
        <ol className="flex items-center justify-between">
          {STAGES.map((s, i) => (
            <li key={s.key} className="flex flex-1 flex-col items-center text-center">
              <span
                className={`h-3 w-3 rounded-full ${i <= stageIndex ? 'bg-brand-orange' : 'bg-sand-200'}`}
                aria-current={i === stageIndex ? 'step' : undefined}
              />
              <span className={`mt-1 text-[10px] ${i <= stageIndex ? 'text-brand-navy' : 'text-sand-400'}`}>
                {s.label}
              </span>
            </li>
          ))}
        </ol>

        {eta && !snapshot?.ended && (
          <div className="flex items-center gap-2 rounded-lg bg-brand-orange-light px-3 py-2 text-sm font-semibold text-brand-orange-dark">
            <Clock size={16} />
            {eta.phase === 'to_pickup' ? 'Arriving in' : 'Reaching drop in'} ~{eta.minutes} min
            {eta.approx ? ' (approx)' : ''}
          </div>
        )}

        {snapshot?.driver && (
          <div className="card space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-navy">
              <Car size={16} /> {snapshot.driver.carModel ?? 'Vehicle'} · {snapshot.driver.plate ?? ''}
            </div>
            <div className="flex items-center gap-2 text-sm text-sand-600">
              <Phone size={14} /> {snapshot.driver.name} · {snapshot.driver.phoneMasked}
            </div>
          </div>
        )}

        <div className="card space-y-2">
          <div className="flex items-start gap-2">
            <MapPin size={16} className="mt-0.5 shrink-0 text-green-600" />
            <span className="text-sm text-brand-navy">{snapshot?.pickup.address}</span>
          </div>
          <div className="flex items-start gap-2">
            <MapPin size={16} className="mt-0.5 shrink-0 text-red-600" />
            <span className="text-sm text-brand-navy">{snapshot?.drop.address}</span>
          </div>
        </div>

        {snapshot?.ended && snapshot.summary && (
          <div className="card text-sm text-sand-600">
            Trip completed · {snapshot.summary.actualKm ?? snapshot.summary.estimatedKm} km ·{' '}
            {snapshot.summary.actualMin ?? snapshot.summary.estimatedMin} min
          </div>
        )}

        {!snapshot?.ended && (
          <button
            onClick={() => void triggerSos()}
            disabled={sosSent}
            className={`w-full rounded-lg py-3 text-sm font-bold ${
              sosSent ? 'bg-sand-200 text-sand-500' : 'bg-red-600 text-white'
            }`}
          >
            {sosSent ? 'SOS sent — help is on the way' : 'Emergency SOS'}
          </button>
        )}
      </section>
    </main>
  );
}
