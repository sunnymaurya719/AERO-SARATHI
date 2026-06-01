'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, Download } from 'lucide-react';
import { useBookingStore } from '@/store/booking';
import { api } from '@/lib/api';
import { formatINR } from '@/lib/places';
import type { BookingDetailResponse } from '@aero/types';

const POLL_MS = 2000;
const MAX_MS = 30_000;

export default function ConfirmedPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const accessToken = useBookingStore((s) => s.accessToken);
  const [booking, setBooking] = useState<BookingDetailResponse | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!accessToken) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const tick = async () => {
      try {
        const b = await api.getBookingByCode(params.code, accessToken);
        if (cancelled) return;
        setBooking(b);
        if (b.status === 'CONFIRMED') return; // done
        if (Date.now() - startRef.current > MAX_MS) {
          setTimedOut(true);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [params.code, accessToken]);

  const confirmed = booking?.status === 'CONFIRMED';

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <div className="card text-center">
        {confirmed ? (
          <>
            <CheckCircle2 className="mx-auto h-14 w-14 text-green-600" />
            <h1 className="mt-4 text-2xl font-bold text-brand-navy">Booking confirmed</h1>
            <p className="my-2 text-3xl font-bold tracking-wide text-brand-orange">{booking!.code}</p>
            <p className="text-sm text-slate-500">Receipt sent to your phone &amp; email.</p>
            {booking && (
              <p className="mt-2 text-sm text-slate-500">
                Token paid {formatINR(booking.tokenAmount)} · Balance {formatINR(booking.balanceAmount)} to driver
              </p>
            )}
            <div className="mt-6 flex flex-col gap-3">
              <a
                className="btn-secondary flex items-center justify-center gap-2"
                href={api.receiptUrl(booking!.id)}
                target="_blank"
                rel="noreferrer"
              >
                <Download className="h-4 w-4" /> Download receipt (PDF)
              </a>
              <div className="flex gap-3">
                <button className="btn-secondary flex-1" onClick={() => router.push('/account/bookings')}>
                  My bookings
                </button>
                <button className="btn-primary flex-1" onClick={() => router.push('/')}>
                  Book another
                </button>
              </div>
            </div>
          </>
        ) : timedOut ? (
          <>
            <Loader2 className="mx-auto h-14 w-14 text-brand-orange" />
            <h1 className="mt-4 text-xl font-bold text-brand-navy">Still processing</h1>
            <p className="mt-2 text-sm text-slate-500">
              Your payment is being confirmed. Check My Bookings shortly — it updates automatically.
            </p>
            <button className="btn-primary mt-6 w-full" onClick={() => router.push('/account/bookings')}>
              Go to My bookings
            </button>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-14 w-14 animate-spin text-brand-orange" />
            <h1 className="mt-4 text-xl font-bold text-brand-navy">Confirming your payment…</h1>
            <p className="mt-2 text-sm text-slate-500">This usually takes a few seconds.</p>
          </>
        )}
      </div>
    </main>
  );
}
