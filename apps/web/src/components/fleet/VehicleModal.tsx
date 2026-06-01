'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  X,
  Users,
  Briefcase,
  Wind,
  Check,
  MapPin,
  Wifi,
  Shield,
  ChevronRight,
  Flame,
} from 'lucide-react';

import { type VehicleDef } from '@/lib/fleet-data';

interface VehicleModalProps {
  vehicle: VehicleDef | null;
  onClose: () => void;
}

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN');
}

export function VehicleModal({ vehicle, onClose }: VehicleModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Escape key + body scroll lock
  useEffect(() => {
    if (!vehicle) return;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [vehicle, onClose]);

  if (!vehicle) return null;

  const { Icon } = vehicle;

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) onClose();
  }

  const specs = [
    { icon: Users, label: 'Passengers', value: `Up to ${vehicle.pax}` },
    { icon: Briefcase, label: 'Luggage', value: `${vehicle.luggageBags} bags` },
    { icon: Wind, label: 'AC', value: vehicle.ac },
    { icon: MapPin, label: 'GPS', value: 'Live tracked' },
    { icon: Shield, label: 'Verified', value: 'Insured & BG' },
    { icon: Wifi, label: 'Wifi', value: vehicle.slug === 'premium' ? 'Included' : 'Not available' },
  ];

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[500] flex items-start justify-center overflow-y-auto bg-[rgba(10,15,30,0.75)] px-4 py-10 backdrop-blur-[8px] md:py-16"
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-[0_32px_80px_rgba(0,0,0,0.35)]"
        style={{ animation: 'modalIn 0.3s ease both' }}
      >
        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden bg-brand-navy-dark px-8 pb-7 pt-8">
          {/* bg glow */}
          <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-brand-orange/10 blur-2xl" />

          {/* close button */}
          <button
            onClick={onClose}
            className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.08] text-white/60 transition hover:border-brand-orange/40 hover:bg-brand-orange/20 hover:text-brand-orange"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="relative z-10 flex items-start gap-5">
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.06]">
              <Icon className="h-9 w-9 text-brand-orange" strokeWidth={1.4} />
            </div>
            <div>
              {vehicle.tag && (
                <div className="mb-1.5 inline-flex items-center gap-1 rounded bg-brand-orange/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
                  <Flame className="h-2.5 w-2.5" />
                  {vehicle.tag}
                </div>
              )}
              <h2 className="font-heading text-[28px] font-bold leading-tight text-white">
                {vehicle.name}
              </h2>
              <p className="mt-0.5 text-[13px] text-white/45">{vehicle.models}</p>
            </div>
          </div>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────────── */}
        <div className="px-8 pb-8 pt-6">
          {/* Specs grid */}
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-sand-500">
            Specifications
          </div>
          <div className="mt-3 mb-6 grid grid-cols-3 gap-3">
            {specs.map(({ icon: SIcon, label, value }) => (
              <div
                key={label}
                className="rounded-xl border border-sand-100 bg-sand-50 p-3.5 text-center"
              >
                <SIcon className="mx-auto mb-1.5 h-5 w-5 text-brand-orange" />
                <div className="text-[10px] uppercase tracking-wider text-sand-500">{label}</div>
                <div className="mt-1 font-heading text-[15px] font-bold text-brand-navy">{value}</div>
              </div>
            ))}
          </div>

          {/* Sample pricing */}
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-sand-500">
            Sample Route Pricing
          </div>
          <div className="mt-3 mb-6 divide-y divide-sand-100 rounded-xl border border-sand-100 overflow-hidden">
            {vehicle.samplePricing.map(({ route, amount }) => (
              <div key={route} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-navy-dark">
                    <ChevronRight className="h-4 w-4 text-brand-orange" />
                  </div>
                  <span className="text-sm font-medium text-brand-navy">{route}</span>
                </div>
                <span className="font-heading text-[22px] font-bold text-brand-orange">
                  {fmt(amount)}
                </span>
              </div>
            ))}
          </div>

          {/* Inclusions */}
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-sand-500">
            What&apos;s Included
          </div>
          <div className="mt-3 mb-6 grid grid-cols-2 gap-2.5">
            {vehicle.inclusions.map((item) => (
              <div key={item} className="flex items-center gap-2 text-[13px] text-brand-navy">
                <Check className="h-4 w-4 flex-shrink-0 text-green-600" strokeWidth={2.5} />
                {item}
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="flex gap-3">
            <Link
              href="/#book"
              onClick={onClose}
              className="flex-1 rounded-xl bg-brand-orange py-3.5 text-center font-heading text-lg font-semibold text-white transition hover:bg-brand-orange-dark hover:shadow-glow"
            >
              Book This Vehicle
            </Link>
            <button
              onClick={onClose}
              className="rounded-xl border border-sand-100 bg-sand-50 px-5 py-3.5 text-sm font-medium text-sand-500 transition hover:border-brand-orange/30 hover:bg-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
      `}</style>
    </div>
  );
}
