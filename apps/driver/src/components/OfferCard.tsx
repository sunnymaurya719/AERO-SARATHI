'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, MapPin } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { DriverOfferView } from '@aero/types';

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

function useCountdown(expiresAt: string): number {
  const [secs, setSecs] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(() => {
      setSecs(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  return secs;
}

export function OfferCard({
  offer,
  onOpen,
  onResolved,
}: {
  offer: DriverOfferView;
  onOpen?: () => void;
  onResolved?: () => void;
}) {
  const secs = useCountdown(offer.expiresAt);

  const acceptM = useMutation({
    mutationFn: () => api(`/offers/${offer.id}/accept`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Trip accepted!');
      onResolved?.();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail ?? 'Could not accept' : 'Could not accept'),
  });

  const declineM = useMutation({
    mutationFn: () =>
      api(`/offers/${offer.id}/decline`, {
        method: 'POST',
        body: { reason: 'Not available for this trip' },
      }),
    onSuccess: () => {
      toast('Offer declined');
      onResolved?.();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail ?? 'Could not decline' : 'Could not decline'),
  });

  const expired = secs <= 0;
  const when = new Date(offer.scheduledAt).toLocaleString('en-IN', {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-sand-500">#{offer.bookingCode}</span>
        <span
          className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
            secs <= 10 ? 'bg-red-100 text-red-700' : 'bg-brand-orange-light text-brand-orange-dark'
          }`}
        >
          <Clock size={12} /> {expired ? 'Expired' : `${secs}s`}
        </span>
      </div>

      <button onClick={onOpen} className="block w-full space-y-2 text-left">
        <div className="flex items-start gap-2">
          <MapPin size={16} className="mt-0.5 shrink-0 text-green-600" />
          <span className="text-sm text-brand-navy">{offer.pickupAddress}</span>
        </div>
        <div className="flex items-start gap-2">
          <MapPin size={16} className="mt-0.5 shrink-0 text-red-600" />
          <span className="text-sm text-brand-navy">{offer.dropAddress}</span>
        </div>
      </button>

      <div className="flex items-center justify-between text-sm">
        <span className="text-sand-500">{when}</span>
        <span className="font-semibold text-brand-navy">
          {rupees(offer.fareToDriver)} · {offer.estimatedKm.toFixed(0)} km
        </span>
      </div>

      <div className="flex gap-2">
        <button
          className="btn-secondary flex-1"
          disabled={expired || declineM.isPending || acceptM.isPending}
          onClick={() => declineM.mutate()}
        >
          Decline
        </button>
        <button
          className="btn-primary flex-1"
          disabled={expired || acceptM.isPending || declineM.isPending}
          onClick={() => acceptM.mutate()}
        >
          {acceptM.isPending ? 'Accepting…' : 'Accept'}
        </button>
      </div>
    </div>
  );
}
