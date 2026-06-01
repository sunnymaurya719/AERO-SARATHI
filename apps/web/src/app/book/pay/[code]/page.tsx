'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Loader2, ShieldCheck, ArrowRight } from 'lucide-react';
import { useBookingStore } from '@/store/booking';
import { api, ApiError } from '@/lib/api';
import { formatINR } from '@/lib/places';
import type { BookingDetailResponse, PaymentIntentResponse } from '@aero/types';

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay: any;
  }
}

export default function PayPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const accessToken = useBookingStore((s) => s.accessToken);

  const [booking, setBooking] = useState<BookingDetailResponse | null>(null);
  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setError('Please sign in to complete your payment.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const b = await api.getBookingByCode(params.code, accessToken);
        if (cancelled) return;
        setBooking(b);
        if (b.status === 'CONFIRMED') {
          router.replace(`/book/confirmed/${params.code}`);
          return;
        }
        const i = await api.createPaymentIntent(b.id, accessToken, `pay-${b.id}`);
        if (!cancelled) setIntent(i);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.problem.detail ?? e.problem.title : 'Could not start payment');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.code, accessToken, router]);

  function openCheckout() {
    if (!intent || !accessToken || !window.Razorpay) return;
    setError(null);
    setPaying(true);

    const rzp = new window.Razorpay({
      key: intent.razorpayKeyId,
      order_id: intent.razorpayOrderId,
      amount: intent.amount,
      currency: intent.currency,
      name: intent.name,
      description: intent.description,
      prefill: intent.prefill,
      notes: intent.notes,
      theme: { color: '#F48024' },
      retry: { enabled: false },
      modal: { ondismiss: () => setPaying(false) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async (resp: any) => {
        try {
          await api.verifyPayment(
            intent.notes.bookingId,
            {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            },
            accessToken,
            `verify-${resp.razorpay_payment_id}`,
          );
          router.replace(`/book/confirmed/${params.code}`);
        } catch {
          // Webhook will still confirm; send the user to the polling screen.
          router.replace(`/book/confirmed/${params.code}`);
        } finally {
          setPaying(false);
        }
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rzp.on('payment.failed', (resp: any) => {
      setPaying(false);
      setError(resp?.error?.description ?? 'Payment failed. Please try again.');
    });
    rzp.open();
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="lazyOnload" onLoad={() => setScriptReady(true)} />

      <h1 className="text-2xl font-bold text-brand-navy">Pay your token</h1>
      <p className="mt-1 text-sm text-slate-500">Secure your booking with a 20% advance. Balance is paid to the driver.</p>

      {booking && (
        <div className="card mt-6 space-y-2">
          <Row label="Booking" value={booking.code} />
          <Row label="Route" value={`${booking.pickupAddress} → ${booking.dropAddress}`} />
          <Row label="When" value={new Date(booking.scheduledAt).toLocaleString('en-IN')} />
          <Row label="Vehicle" value={booking.vehicleCategory} />
          <div className="my-2 border-t border-sand-200" />
          <Row label="Total fare" value={formatINR(booking.fareTotal)} />
          <Row label="Pay driver (balance)" value={formatINR(booking.balanceAmount)} />
          <div className="flex items-center justify-between pt-1">
            <span className="font-semibold text-brand-navy">Pay now (token)</span>
            <span className="text-xl font-bold text-brand-orange">{formatINR(booking.tokenAmount)}</span>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        className="btn-primary mt-6 flex w-full items-center justify-center gap-2"
        disabled={!intent || !scriptReady || paying}
        onClick={openCheckout}
      >
        {paying ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Opening checkout…
          </>
        ) : !intent || !scriptReady ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
          </>
        ) : (
          <>
            Pay {booking ? formatINR(booking.tokenAmount) : ''} securely <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      <p className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5" /> Payments processed securely by Razorpay (UPI, cards, netbanking)
      </p>
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
