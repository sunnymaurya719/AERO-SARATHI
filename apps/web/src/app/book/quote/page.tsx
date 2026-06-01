'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBookingStore } from '@/store/booking';
import { formatINR } from '@/lib/places';
import { VEHICLE_CATEGORIES } from '@aero/types';

const CATEGORY_LABEL: Record<string, string> = {
  HATCHBACK: 'Hatchback',
  SEDAN: 'Sedan',
  SUV: 'SUV',
  LUXURY: 'Luxury',
};

export default function QuotePage() {
  const router = useRouter();
  const quote = useBookingStore((s) => s.quote);
  const pickup = useBookingStore((s) => s.pickup);
  const drop = useBookingStore((s) => s.drop);
  const selectCategory = useBookingStore((s) => s.selectCategory);

  useEffect(() => {
    if (!quote) router.replace('/');
  }, [quote, router]);

  if (!quote) return null;

  const expired = new Date(quote.expiresAt).getTime() < Date.now();
  const order = VEHICLE_CATEGORIES;
  const fares = [...quote.fares].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <button className="mb-6 text-sm text-slate-500 underline" onClick={() => router.push('/')}>
        ← Change trip
      </button>

      <h1 className="text-2xl font-bold text-brand-navy">Choose your vehicle</h1>
      <p className="mt-1 text-slate-500">
        {pickup?.address} → {drop?.address}
      </p>
      <p className="mt-1 text-sm text-slate-500">
        ~{quote.distanceKm.toFixed(1)} km · ~{quote.durationMin} min
      </p>

      {expired && (
        <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          This quote has expired. <button className="underline" onClick={() => router.push('/')}>Get a fresh quote</button>.
        </div>
      )}

      <div className="mt-6 space-y-3">
        {fares.map((f) => (
          <button
            key={f.category}
            disabled={expired}
            className="card flex w-full items-center justify-between text-left transition hover:border-brand-orange disabled:opacity-50"
            onClick={() => {
              selectCategory(f.category);
              router.push('/book/confirm');
            }}
          >
            <div>
              <div className="text-lg font-semibold text-brand-navy">{CATEGORY_LABEL[f.category]}</div>
              <div className="text-sm text-slate-500">Token now {formatINR(f.tokenAmount)} · Balance {formatINR(f.balanceAmount)}</div>
            </div>
            <div className="text-2xl font-bold text-brand-orange">{formatINR(f.total)}</div>
          </button>
        ))}
      </div>
    </main>
  );
}
