'use client';

import { useQuery } from '@tanstack/react-query';
import { MapPin, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import type { DriverTripRow } from '@aero/types';

const STATUS_LABEL: Record<string, string> = {
  DRIVER_ASSIGNED: 'Assigned',
  EN_ROUTE: 'En route',
  ONGOING: 'Ongoing',
};

export default function TripsPage() {
  const tripsQ = useQuery({
    queryKey: ['trips', 'today'],
    queryFn: () => api<{ items: DriverTripRow[] }>('/trips/today'),
    refetchInterval: 30_000,
  });

  const trips = tripsQ.data?.items ?? [];

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-sand-500">Upcoming trips</h2>

      {tripsQ.isLoading ? (
        <p className="text-sand-500">Loading…</p>
      ) : trips.length === 0 ? (
        <div className="card text-center text-sm text-sand-500">No upcoming trips.</div>
      ) : (
        <div className="space-y-3">
          {trips.map((t) => (
            <div key={t.id} className="card space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-sand-500">#{t.code}</span>
                <span className="rounded-full bg-brand-orange-light px-2 py-1 text-xs font-semibold text-brand-orange-dark">
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
              </div>
              <p className="text-sm font-medium text-brand-navy">
                {new Date(t.scheduledAt).toLocaleString('en-IN', {
                  weekday: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              <div className="flex items-start gap-2">
                <MapPin size={16} className="mt-0.5 shrink-0 text-green-600" />
                <span className="text-sm text-brand-navy">{t.pickupAddress}</span>
              </div>
              <div className="flex items-start gap-2">
                <MapPin size={16} className="mt-0.5 shrink-0 text-red-600" />
                <span className="text-sm text-brand-navy">{t.dropAddress}</span>
              </div>
              <div className="flex items-center gap-2 border-t border-sand-100 pt-2 text-sm text-sand-500">
                <Phone size={14} />
                {t.passengerName} · {t.passengerPhoneMasked}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
