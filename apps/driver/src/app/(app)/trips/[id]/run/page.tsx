'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Navigation, Phone, AlertTriangle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { connectSocket } from '@/lib/socket';
import { startGeoPublisher, type GeoPing, type GeoPublisherHandle } from '@/lib/geo';
import type { DriverTripDetail } from '@aero/types';

const idem = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

type Action = 'start' | 'arrived' | 'begin' | 'complete' | 'no-show';

export default function TripRunPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<GeoPing | null>(null);
  const publisherRef = useRef<GeoPublisherHandle | null>(null);

  const tripQ = useQuery({
    queryKey: ['trip', 'run', id],
    queryFn: () => api<DriverTripDetail>(`/trips/${id}/run`),
    refetchInterval: 10_000,
  });
  const trip = tripQ.data;
  const stage = trip?.stage;

  // Publish GPS only while the trip is live (en route / arrived / ongoing).
  useEffect(() => {
    const live = stage === 'en_route' || stage === 'arrived' || stage === 'ongoing';
    if (live && !publisherRef.current) {
      connectSocket();
      publisherRef.current = startGeoPublisher(setFix);
    }
    if (!live && publisherRef.current) {
      publisherRef.current.stop();
      publisherRef.current = null;
    }
    return () => {
      publisherRef.current?.stop();
      publisherRef.current = null;
    };
  }, [stage]);

  async function act(action: Action, query = ''): Promise<void> {
    setBusy(action);
    setError(null);
    try {
      await api<DriverTripDetail>(`/trips/${id}/${action}${query}`, {
        method: 'POST',
        body: {},
        headers: { 'Idempotency-Key': idem() },
      });
      await tripQ.refetch();
    } catch (err) {
      const e = err as ApiError;
      // Far-from-pickup needs an explicit confirm.
      if (action === 'arrived' && e.status === 400 && e.detail?.includes('too_far')) {
        if (confirm('You appear far from the pickup. Confirm arrival anyway?')) {
          await act('arrived', '?force=true');
          return;
        }
      }
      setError(e.detail ?? e.message);
    } finally {
      setBusy(null);
    }
  }

  if (tripQ.isLoading) return <p className="text-sand-500">Loading…</p>;
  if (!trip) return <p className="text-sand-500">Trip not found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sand-500">Trip #{trip.code}</h2>
        <span className="rounded-full bg-brand-orange-light px-3 py-1 text-xs font-semibold text-brand-orange-dark">
          {stageLabel(stage)}
        </span>
      </div>

      <div className="card space-y-3">
        <div className="flex items-start gap-2">
          <MapPin size={16} className="mt-0.5 shrink-0 text-green-600" />
          <span className="text-sm text-brand-navy">{trip.pickup.address}</span>
        </div>
        <div className="flex items-start gap-2">
          <MapPin size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="text-sm text-brand-navy">{trip.drop.address}</span>
        </div>
        <div className="flex items-center gap-2 border-t border-sand-100 pt-2 text-sm text-sand-500">
          <Phone size={14} />
          {trip.passengerName} · {trip.passengerPhoneMasked}
        </div>
        {fix && (
          <div className="flex items-center gap-2 text-xs text-sand-500">
            <Navigation size={12} />
            {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)} · ±{fix.accuracyM}m
            {fix.speedKmh != null ? ` · ${fix.speedKmh} km/h` : ''}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      <div className="space-y-2">
        {stage === 'assigned' && (
          <button className="btn-primary w-full" disabled={busy != null} onClick={() => void act('start')}>
            {busy === 'start' ? 'Starting…' : 'Start trip'}
          </button>
        )}
        {stage === 'en_route' && (
          <>
            <button className="btn-primary w-full" disabled={busy != null} onClick={() => void act('arrived')}>
              {busy === 'arrived' ? 'Marking…' : "I've arrived"}
            </button>
            <button
              className="w-full rounded-lg border border-red-200 py-2 text-sm font-semibold text-red-600"
              disabled={busy != null}
              onClick={() => {
                if (confirm('Mark this booking as a passenger no-show?')) void act('no-show');
              }}
            >
              {busy === 'no-show' ? 'Recording…' : 'Passenger no-show'}
            </button>
          </>
        )}
        {stage === 'arrived' && (
          <button className="btn-primary w-full" disabled={busy != null} onClick={() => void act('begin')}>
            {busy === 'begin' ? 'Starting ride…' : 'Begin ride'}
          </button>
        )}
        {stage === 'ongoing' && (
          <button className="btn-primary w-full" disabled={busy != null} onClick={() => void act('complete')}>
            {busy === 'complete' ? 'Completing…' : 'Complete ride'}
          </button>
        )}
        {stage === 'completed' && (
          <button className="btn-primary w-full" onClick={() => router.push('/trips')}>
            Done
          </button>
        )}
      </div>
    </div>
  );
}

function stageLabel(stage?: string): string {
  switch (stage) {
    case 'assigned':
      return 'Assigned';
    case 'en_route':
      return 'En route';
    case 'arrived':
      return 'At pickup';
    case 'ongoing':
      return 'Ride ongoing';
    case 'completed':
      return 'Completed';
    default:
      return stage ?? '';
  }
}
