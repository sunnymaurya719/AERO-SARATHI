'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { getSocket, connectSocket } from '@/lib/socket';
import type { DriverMe, DriverOfferView } from '@aero/types';
import { OfferCard } from '@/components/OfferCard';

export default function HomePage() {
  const router = useRouter();
  const qc = useQueryClient();

  const meQ = useQuery({ queryKey: ['me'], queryFn: () => api<DriverMe>('/me') });
  const offersQ = useQuery({
    queryKey: ['offers', 'active'],
    queryFn: () => api<{ items: DriverOfferView[] }>('/offers/active'),
    refetchInterval: 10_000,
  });

  // Realtime: refetch on new/cancelled offers.
  useEffect(() => {
    const socket = getSocket() ?? connectSocket();
    if (!socket) return;
    const refetch = () => void qc.invalidateQueries({ queryKey: ['offers', 'active'] });
    const onNew = () => {
      toast.info('New trip offer!');
      refetch();
    };
    socket.on('offer:new', onNew);
    socket.on('offer:cancelled', refetch);
    socket.on('offer:expired', refetch);
    return () => {
      socket.off('offer:new', onNew);
      socket.off('offer:cancelled', refetch);
      socket.off('offer:expired', refetch);
    };
  }, [qc]);

  const availabilityM = useMutation({
    mutationFn: (availability: 'ONLINE' | 'OFFLINE') =>
      api<{ availability: string }>('/me/availability', { method: 'PATCH', body: { availability } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (err) => {
      if (err instanceof ApiError && err.detail === 'cannot_go_online') {
        toast.error('Resolve document/profile issues before going online');
      } else {
        toast.error('Could not update availability');
      }
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const me = meQ.data;
  const online = me?.availability === 'ONLINE';
  const offers = offersQ.data?.items ?? [];

  return (
    <div className="space-y-5">
      {me && (
        <section className="card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-lg font-semibold text-brand-navy">Hi, {me.name}</p>
              <p className="text-sm text-sand-500">
                {me.vehicle ? `${me.vehicle.model} · ${me.vehicle.regNo}` : 'No vehicle assigned'}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                online ? 'bg-green-100 text-green-700' : 'bg-sand-100 text-sand-500'
              }`}
            >
              {me.availability}
            </span>
          </div>

          <button
            className={online ? 'btn-secondary mt-4 w-full' : 'btn-primary mt-4 w-full'}
            disabled={availabilityM.isPending}
            onClick={() => availabilityM.mutate(online ? 'OFFLINE' : 'ONLINE')}
          >
            {availabilityM.isPending ? 'Updating…' : online ? 'Go Offline' : 'Go Online'}
          </button>

          {me.documents.some((d) => d.expired || !d.verified) && (
            <p className="mt-3 text-xs text-red-600">
              Some documents are missing, unverified, or expired. You cannot go online until resolved.
            </p>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sand-500">
          Active offers
        </h2>
        {offers.length === 0 ? (
          <div className="card text-center text-sm text-sand-500">
            {online ? 'Waiting for trip offers…' : 'Go online to receive trip offers.'}
          </div>
        ) : (
          <div className="space-y-3">
            {offers.map((o) => (
              <OfferCard
                key={o.id}
                offer={o}
                onOpen={() => router.push(`/offers/${o.id}`)}
                onResolved={() => qc.invalidateQueries({ queryKey: ['offers', 'active'] })}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
