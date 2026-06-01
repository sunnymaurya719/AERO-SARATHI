'use client';

import { useEffect } from 'react';
import { X, Check, Car, Users, Crown, Truck, MapPin, ArrowRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RouteDef } from '@/lib/routes-data';
import { ROUTE_INCLUSIONS } from '@/lib/routes-data';
import { formatINR } from '@/lib/places';

const VEHICLE_ROWS: { key: keyof RouteDef['pricing']; name: string; cap: string; icon: LucideIcon }[] = [
  { key: 'sedan', name: 'Sedan', cap: 'Up to 4 · Dzire', icon: Car },
  { key: 'suv', name: 'SUV', cap: 'Up to 6 · Ertiga', icon: Users },
  { key: 'premium', name: 'Premium SUV', cap: 'Up to 6 · Innova', icon: Crown },
  { key: 'tempo', name: 'Tempo Traveller', cap: 'Up to 12 seats', icon: Truck },
];

export function RouteModal({
  route,
  onClose,
  onBook,
}: {
  route: RouteDef | null;
  onClose: () => void;
  onBook: (route: RouteDef) => void;
}) {
  useEffect(() => {
    if (!route) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [route, onClose]);

  if (!route) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-brand-navy-dark/70 p-4 backdrop-blur-sm sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-3xl animate-fadeUp overflow-y-auto rounded-3xl bg-white shadow-card">
        {/* Header */}
        <div className="relative rounded-t-3xl bg-brand-navy-dark px-6 py-7 sm:px-8">
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
          <h3 className="font-heading text-2xl font-bold text-white sm:text-3xl">
            {route.fromCity} <span className="text-brand-orange">→</span> {route.toCity}
          </h3>
          <p className="mt-1.5 text-[13px] text-white/45">
            ~{route.distanceKm} km · {route.durationLabel} · {route.toState} · 24/7 Available
          </p>
        </div>

        <div className="px-6 py-7 sm:px-8">
          {/* Pricing */}
          <ModalSectionTitle>Pricing by Vehicle</ModalSectionTitle>
          <div className="mb-8 grid gap-3 sm:grid-cols-2">
            {VEHICLE_ROWS.map((v) => (
              <div
                key={v.key}
                className="flex items-center justify-between rounded-xl border border-sand-100 bg-sand-50 px-4 py-3.5 transition hover:border-brand-orange"
              >
                <div className="flex items-center gap-3">
                  <v.icon className="h-6 w-6 text-brand-orange" strokeWidth={1.5} />
                  <div>
                    <div className="text-sm font-medium text-brand-navy">{v.name}</div>
                    <div className="text-[11px] text-sand-500">{v.cap}</div>
                  </div>
                </div>
                <div className="font-heading text-xl font-bold text-brand-orange">
                  {formatINR(route.pricing[v.key])}
                </div>
              </div>
            ))}
          </div>

          {/* Inclusions */}
          <ModalSectionTitle>What&apos;s Included</ModalSectionTitle>
          <div className="mb-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {ROUTE_INCLUSIONS.map((inc) => (
              <div key={inc} className="flex items-center gap-2 text-[13px] text-brand-navy">
                <Check className="h-4 w-4 text-[#16a34a]" strokeWidth={3} /> {inc}
              </div>
            ))}
          </div>

          {/* Stops */}
          <ModalSectionTitle>Route Stops</ModalSectionTitle>
          <div className="mb-8">
            {route.stops.map((stop, i) => {
              const isLast = i === route.stops.length - 1;
              return (
                <div key={stop.name} className="relative flex gap-4 pb-5 last:pb-0">
                  {!isLast && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-sand-200" />}
                  <span
                    className={`relative z-[1] flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 text-[10px] ${
                      stop.kind === 'start'
                        ? 'border-brand-orange bg-brand-orange text-white'
                        : stop.kind === 'end'
                          ? 'border-brand-navy bg-brand-navy text-white'
                          : 'border-sand-200 bg-sand-50 text-sand-500'
                    }`}
                  >
                    <MapPin className="h-3 w-3" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-brand-navy">{stop.name}</div>
                    <div className="mt-0.5 text-xs text-sand-500">{stop.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick book */}
          <div className="rounded-2xl border border-sand-100 bg-sand-50 p-5 sm:p-6">
            <h4 className="mb-4 font-heading text-base font-semibold text-brand-navy">Quick Book This Route</h4>
            <button
              onClick={() => onBook(route)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-orange px-6 py-3.5 font-heading text-lg font-semibold text-white transition hover:bg-brand-orange-dark hover:shadow-glow"
            >
              Continue to Booking <ArrowRight className="h-5 w-5" />
            </button>
            <p className="mt-3 text-center text-[11px] text-sand-500">
              Pay a small token to confirm · Balance to the driver
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3.5 inline-block border-b-2 border-brand-orange pb-1.5 font-heading text-base font-semibold text-brand-navy">
      {children}
    </div>
  );
}
