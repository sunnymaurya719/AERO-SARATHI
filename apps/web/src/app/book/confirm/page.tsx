'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { useBookingStore } from '@/store/booking';
import { api, ApiError } from '@/lib/api';
import { formatINR } from '@/lib/places';
import { OtpModal } from '@/components/OtpModal';

export default function ConfirmPage() {
  const router = useRouter();
  const quote = useBookingStore((s) => s.quote);
  const category = useBookingStore((s) => s.selectedCategory);
  const accessToken = useBookingStore((s) => s.accessToken);
  const user = useBookingStore((s) => s.user);
  const reset = useBookingStore((s) => s.reset);

  const [name, setName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('+91');
  const [showOtp, setShowOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!quote || !category) router.replace('/');
  }, [quote, category, router]);

  const fare = quote?.fares.find((f) => f.category === category);

  const mutation = useMutation({
    mutationFn: () => {
      if (!quote || !category || !accessToken) throw new Error('Missing data');
      const idempotencyKey = `book-${quote.quoteId}-${category}`;
      return api.createBooking(
        { quoteId: quote.quoteId, vehicleCategory: category, passengerName: name, passengerPhone },
        accessToken,
        idempotencyKey,
      );
    },
    onSuccess: (b) => {
      reset();
      router.push(`/book/pay/${b.code}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : 'Booking failed'),
  });

  function handleConfirm() {
    setError(null);
    if (!accessToken) {
      setShowOtp(true);
      return;
    }
    mutation.mutate();
  }

  if (!quote || !category || !fare) return null;

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <button className="mb-6 text-sm text-slate-500 underline" onClick={() => router.push('/book/quote')}>
        ← Back to vehicles
      </button>

      <h1 className="text-2xl font-bold text-brand-navy">Confirm your booking</h1>

      <div className="card mt-6 space-y-2">
        <Row label="Vehicle" value={category} />
        <Row label="Total fare" value={formatINR(fare.total)} />
        <Row label="Pay now (token)" value={formatINR(fare.tokenAmount)} />
        <Row label="Pay driver (balance)" value={formatINR(fare.balanceAmount)} />
      </div>

      <div className="card mt-4 space-y-4">
        {user && <p className="text-sm text-green-700">Signed in as {user.phone}</p>}
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-600">Passenger name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-600">Passenger phone</span>
          <input
            className="input"
            value={passengerPhone}
            onChange={(e) => setPassengerPhone(e.target.value)}
            placeholder="+91XXXXXXXXXX"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          className="btn-primary w-full"
          disabled={mutation.isPending || name.trim().length === 0 || !/^\+91\d{10}$/.test(passengerPhone)}
          onClick={handleConfirm}
        >
          {mutation.isPending ? 'Confirming…' : accessToken ? `Continue to payment` : 'Verify phone & continue'}
        </button>
      </div>

      {showOtp && (
        <OtpModal
          onClose={() => setShowOtp(false)}
          onVerified={() => {
            setShowOtp(false);
            mutation.mutate();
          }}
        />
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-brand-navy">{value}</span>
    </div>
  );
}
