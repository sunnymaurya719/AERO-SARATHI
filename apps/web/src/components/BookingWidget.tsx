'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { MapPin, Navigation, CalendarClock, ShieldCheck, ArrowRight, Plane, Building2, LocateFixed, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { PRESET_PLACES } from '@/lib/places';
import { useBookingStore } from '@/store/booking';

const TABS = [
  { id: 'airport', label: 'Airport', icon: Plane },
  { id: 'intercity', label: 'Intercity', icon: Building2 },
  { id: 'local', label: 'Local', icon: LocateFixed },
] as const;

function defaultScheduledAt(): string {
  // 3 hours from now, rounded to the next quarter hour, formatted for datetime-local.
  const d = new Date(Date.now() + 3 * 3600_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BookingWidget() {
  const router = useRouter();
  const setTrip = useBookingStore((s) => s.setTrip);
  const setQuote = useBookingStore((s) => s.setQuote);

  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('airport');
  const [pickupIdx, setPickupIdx] = useState(1);
  const [dropIdx, setDropIdx] = useState(0);
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const pickup = PRESET_PLACES[pickupIdx]!;
      const drop = PRESET_PLACES[dropIdx]!;
      const iso = new Date(scheduledAt).toISOString();
      setTrip(pickup, drop, iso);
      return api.createQuote({ pickup, drop, scheduledAt: iso });
    },
    onSuccess: (quote) => {
      setQuote(quote);
      router.push('/book/quote');
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : 'Something went wrong'),
  });

  const sameLocation = pickupIdx === dropIdx;

  return (
    <div className="w-full max-w-md animate-fadeUp rounded-[20px] bg-white p-5 shadow-card sm:p-7">
      <div className="mb-6 flex gap-1 rounded-[10px] bg-sand-100 p-1">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-[13px] font-medium transition ${
                active ? 'bg-white text-brand-navy shadow-sm' : 'text-sand-500 hover:text-brand-navy'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3.5">
        <Field label="Pickup" icon={<MapPin className="h-4 w-4 text-brand-orange" />}>
          <select
            className="input pl-10"
            value={pickupIdx}
            onChange={(e) => setPickupIdx(Number(e.target.value))}
          >
            {PRESET_PLACES.map((p, i) => (
              <option key={p.placeId} value={i}>
                {p.address}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Drop" icon={<Navigation className="h-4 w-4 text-brand-orange" />}>
          <select
            className="input pl-10"
            value={dropIdx}
            onChange={(e) => setDropIdx(Number(e.target.value))}
          >
            {PRESET_PLACES.map((p, i) => (
              <option key={p.placeId} value={i}>
                {p.address}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Pickup date & time" icon={<CalendarClock className="h-4 w-4 text-brand-orange" />}>
          <input
            type="datetime-local"
            className="input pl-10"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </Field>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {sameLocation && <p className="text-sm text-amber-600">Pickup and drop must differ.</p>}

        <button
          className="btn-primary relative mt-1 w-full overflow-hidden text-lg"
          disabled={mutation.isPending || sameLocation}
          onClick={() => {
            setError(null);
            mutation.mutate();
          }}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Searching…
            </>
          ) : (
            <>
              Search &amp; Book Ride
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
          {/* Indeterminate progress bar while fetching fares */}
          {mutation.isPending && (
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-white/25">
              <span className="absolute inset-y-0 left-0 w-1/4 animate-progressSlide rounded-full bg-white" />
            </span>
          )}
        </button>

        <div className="mt-1 flex items-center justify-center gap-1.5 text-[11px] text-sand-500">
          <ShieldCheck className="h-3.5 w-3.5 text-brand-orange" />
          Secure booking · Pay a small token to confirm
        </div>
      </div>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-sand-500">{label}</span>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3.5">{icon}</span>
        {children}
      </div>
    </label>
  );
}
