'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { useBookingStore } from '@/store/booking';
import { api, ApiError } from '@/lib/api';
import { formatINR } from '@/lib/places';

export default function CancelBookingPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const accessToken = useBookingStore((s) => s.accessToken);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: preview, isLoading } = useQuery({
    queryKey: ['cancel-preview', params.id],
    queryFn: () => api.cancelPreview(params.id, accessToken!),
    enabled: !!accessToken,
  });

  const mutation = useMutation({
    mutationFn: () => api.cancelBooking(params.id, reason.trim(), accessToken!, `cancel-${params.id}`),
    onSuccess: () => router.replace(`/account/bookings/${params.id}`),
    onError: (e) => setError(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Cancellation failed'),
  });

  const reasonValid = reason.trim().length >= 8;

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <button className="mb-6 text-sm text-slate-500 underline" onClick={() => router.back()}>
        ← Back
      </button>
      <h1 className="text-2xl font-bold text-brand-navy">Cancel booking</h1>

      {!accessToken && <p className="mt-6 text-slate-500">Please sign in.</p>}
      {accessToken && isLoading && <p className="mt-6 text-slate-500">Checking cancellation policy…</p>}

      {preview && !preview.eligible && (
        <div className="card mt-6 border border-amber-200 bg-amber-50">
          <p className="text-sm text-amber-800">{preview.reason ?? 'This booking cannot be cancelled.'}</p>
          <button className="btn-secondary mt-4 w-full" onClick={() => router.push(`/account/bookings/${params.id}`)}>
            Back to booking
          </button>
        </div>
      )}

      {preview && preview.eligible && (
        <>
          <div className="card mt-6 border border-orange-light bg-brand-orange-light/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
              <div>
                <p className="text-sm font-semibold text-brand-navy">{preview.explanation}</p>
                <div className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Token paid</span>
                    <span className="font-semibold text-brand-navy">{formatINR(preview.tokenPaid ?? 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cancellation fee</span>
                    <span className="font-semibold text-red-600">− {formatINR(preview.feeAmount ?? 0)}</span>
                  </div>
                  <div className="flex justify-between border-t border-sand-200 pt-1">
                    <span className="font-semibold text-brand-navy">You get refunded</span>
                    <span className="font-bold text-green-700">{formatINR(preview.refundAmount ?? 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <label className="mt-4 block">
            <span className="mb-1 block text-sm font-medium text-slate-600">Reason for cancelling</span>
            <textarea
              className="input min-h-[90px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Tell us why (helps us improve)"
            />
            {!reasonValid && reason.length > 0 && (
              <span className="text-xs text-red-500">Please enter at least 8 characters.</span>
            )}
          </label>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <div className="mt-4 flex gap-3">
            <button className="btn-secondary flex-1" onClick={() => router.push(`/account/bookings/${params.id}`)}>
              Keep booking
            </button>
            <button
              className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              disabled={!reasonValid || mutation.isPending}
              onClick={() => {
                setError(null);
                mutation.mutate();
              }}
            >
              {mutation.isPending ? 'Cancelling…' : `Cancel & refund ${formatINR(preview.refundAmount ?? 0)}`}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
