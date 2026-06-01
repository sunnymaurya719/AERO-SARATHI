'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useBookingStore } from '@/store/booking';
import { api } from '@/lib/api';
import { formatINR } from '@/lib/places';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function BookingsPage() {
  const router = useRouter();
  const accessToken = useBookingStore((s) => s.accessToken);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['bookings'],
    queryFn: () => api.listBookings(accessToken!),
    enabled: !!accessToken,
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <button className="mb-6 text-sm text-slate-500 underline" onClick={() => router.push('/')}>
        ← Home
      </button>
      <h1 className="text-2xl font-bold text-brand-navy">My bookings</h1>

      {!accessToken && <p className="mt-6 text-slate-500">Please book a ride to sign in and view your bookings.</p>}
      {accessToken && isLoading && <p className="mt-6 text-slate-500">Loading…</p>}
      {accessToken && isError && <p className="mt-6 text-red-600">Could not load bookings.</p>}

      <div className="mt-6 space-y-3">
        {data?.items.map((b) => (
          <button
            key={b.id}
            onClick={() => router.push(`/account/bookings/${b.id}`)}
            className="card flex w-full items-center justify-between text-left transition hover:shadow-card"
          >
            <div>
              <div className="font-semibold text-brand-navy">{b.code}</div>
              <div className="text-sm text-slate-500">
                {b.pickupAddress} → {b.dropAddress}
              </div>
              <div className="text-sm text-slate-500">{new Date(b.scheduledAt).toLocaleString('en-IN')}</div>
            </div>
            <div className="text-right">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLOR[b.status] ?? 'bg-slate-100 text-slate-700'}`}>
                {b.status}
              </span>
              <div className="mt-2 font-bold text-brand-orange">{formatINR(b.fareTotal)}</div>
            </div>
          </button>
        ))}
        {data && data.items.length === 0 && <p className="text-slate-500">No bookings yet.</p>}
      </div>
    </main>
  );
}
