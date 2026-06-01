'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Download, CreditCard, XCircle } from 'lucide-react';
import { useBookingStore } from '@/store/booking';
import { api } from '@/lib/api';
import { formatINR } from '@/lib/places';

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
};

export default function BookingDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const accessToken = useBookingStore((s) => s.accessToken);

  const { data: b, isLoading, isError } = useQuery({
    queryKey: ['booking', params.id],
    queryFn: () => api.getBooking(params.id, accessToken!),
    enabled: !!accessToken,
  });

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <button className="mb-6 text-sm text-slate-500 underline" onClick={() => router.push('/account/bookings')}>
        ← My bookings
      </button>

      {!accessToken && <p className="text-slate-500">Please sign in to view this booking.</p>}
      {accessToken && isLoading && <p className="text-slate-500">Loading…</p>}
      {accessToken && isError && <p className="text-red-600">Could not load booking.</p>}

      {b && (
        <>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-brand-navy">{b.code}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {b.pickupAddress} → {b.dropAddress}
              </p>
              <p className="text-sm text-slate-500">{new Date(b.scheduledAt).toLocaleString('en-IN')}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLOR[b.status] ?? 'bg-slate-100 text-slate-700'}`}>
              {b.status}
            </span>
          </div>

          <div className="card mt-6 space-y-2">
            <Row label="Vehicle" value={b.vehicleCategory} />
            <Row label="Passenger" value={`${b.passengerName} · ${b.passengerPhone}`} />
            <Row label="Estimate" value={`${b.estimatedKm.toFixed(1)} km · ${b.estimatedMin} min`} />
            <div className="my-2 border-t border-sand-200" />
            <Row label="Total fare" value={formatINR(b.fareTotal)} />
            <Row label="Token" value={formatINR(b.tokenAmount)} />
            <Row label="Balance (to driver)" value={formatINR(b.balanceAmount)} />
          </div>

          {b.payments.length > 0 && (
            <div className="card mt-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-orange">Payments</h2>
              <div className="space-y-2">
                {b.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-sm">
                    <span className="text-slate-500">
                      {p.type} · {p.method ?? '—'}
                    </span>
                    <span className="font-semibold text-brand-navy">
                      {formatINR(p.amountPaid || p.amount)} · {p.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {b.cancellation && (
            <div className="card mt-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-red-600">Cancellation</h2>
              <Row label="Policy" value={b.cancellation.bucket} />
              <Row label="Fee retained" value={formatINR(b.cancellation.feeAmount)} />
              <Row label="Refund" value={formatINR(b.cancellation.refundAmount)} />
              <Row label="Refund status" value={b.cancellation.refundStatus ?? '—'} />
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3">
            {b.status === 'PENDING' && (
              <button
                className="btn-primary flex items-center justify-center gap-2"
                onClick={() => router.push(`/book/pay/${b.code}`)}
              >
                <CreditCard className="h-4 w-4" /> Pay token {formatINR(b.tokenAmount)}
              </button>
            )}
            {b.status === 'CONFIRMED' && (
              <a
                className="btn-secondary flex items-center justify-center gap-2"
                href={api.receiptUrl(b.id)}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="h-4 w-4" /> Download receipt (PDF)
              </a>
            )}
            {b.canCancel && (
              <button
                className="flex items-center justify-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50"
                onClick={() => router.push(`/account/bookings/${b.id}/cancel`)}
              >
                <XCircle className="h-4 w-4" /> Cancel booking
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-brand-navy">{value}</span>
    </div>
  );
}
