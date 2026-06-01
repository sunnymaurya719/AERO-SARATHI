'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DriverOfferView } from '@aero/types';
import { OfferCard } from '@/components/OfferCard';

export default function OfferDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const offersQ = useQuery({
    queryKey: ['offers', 'active'],
    queryFn: () => api<{ items: DriverOfferView[] }>('/offers/active'),
    refetchInterval: 5_000,
  });

  const offer = offersQ.data?.items.find((o) => o.id === params.id);

  return (
    <div className="space-y-4">
      <button onClick={() => router.push('/home')} className="text-sm text-sand-500 underline">
        ← Back
      </button>

      {offersQ.isLoading ? (
        <p className="text-sand-500">Loading…</p>
      ) : offer ? (
        <OfferCard offer={offer} onResolved={() => router.push('/home')} />
      ) : (
        <div className="card text-center text-sm text-sand-500">
          This offer is no longer available.
        </div>
      )}
    </div>
  );
}
