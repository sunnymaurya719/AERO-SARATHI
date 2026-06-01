'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  Users,
  Briefcase,
  Wind,
  Check,
  X,
  Flame,
  Shield,
  MapPin,
  Wifi,
  Zap,
  Star,
} from 'lucide-react';

import {
  VEHICLES,
  FEATURED_VEHICLE,
  NON_FEATURED_VEHICLES,
  FLEET_STATS,
  CATEGORY_TABS,
  COMPARE_ROWS,
  USE_CASES,
  type TabKey,
  type VehicleDef,
  type VehicleSlug,
} from '@/lib/fleet-data';

import { VehicleModal } from './VehicleModal';
import { CountUp } from '../ui/CountUp';
import { Reveal } from '../ui/Reveal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return '₹' + n.toLocaleString('en-IN');
}

// ── Featured Vehicle Card ─────────────────────────────────────────────────────

function FeaturedVehicleCard({
  vehicle: v,
  onOpen,
}: {
  vehicle: VehicleDef;
  onOpen: (v: VehicleDef) => void;
}) {
  const Icon = v.Icon;
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-orange/10 bg-brand-navy-dark shadow-[0_8px_40px_rgba(30,45,90,0.22)] transition hover:shadow-[0_12px_56px_rgba(30,45,90,0.32)] md:grid md:grid-cols-2">
      {/* Left — info */}
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-navy-dark to-[#1a2550] p-8 md:p-12">
        {/* bg glow */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-brand-orange/10 blur-2xl" />

        {/* Badge */}
        <div className="mb-5 inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white">
          <Flame className="h-3 w-3" />
          {v.tag ?? 'Featured'}
        </div>

        <h3 className="mb-1 font-heading text-[38px] font-bold leading-none text-white">{v.name}</h3>
        <p className="mb-7 text-sm leading-relaxed text-white/50">{v.tagline}</p>

        {/* Specs 2×2 grid */}
        <div className="mb-8 grid grid-cols-2 gap-4">
          {[
            { icon: Users, label: 'Passengers', value: `Up to ${v.pax}` },
            { icon: Briefcase, label: 'Luggage', value: `${v.luggageBags} large bags` },
            { icon: Wind, label: 'Air Conditioning', value: v.ac },
            { icon: Shield, label: 'Verification', value: 'GPS + Insured' },
          ].map(({ icon: SIcon, label, value }) => (
            <div
              key={label}
              className="rounded-xl border border-white/[0.06] bg-white/[0.04] p-4"
            >
              <SIcon className="mb-1.5 h-4 w-4 text-brand-orange" />
              <div className="text-[10px] uppercase tracking-wider text-white/40">{label}</div>
              <div className="mt-1 font-heading text-base font-semibold text-white">{value}</div>
            </div>
          ))}
        </div>

        {/* Price row */}
        <div className="mb-5 flex items-center justify-between rounded-xl border border-brand-orange/20 bg-brand-orange/10 px-5 py-4">
          <div>
            <div className="text-xs text-white/50">Starts from</div>
            <div className="font-heading text-[28px] font-bold leading-none text-brand-orange">
              {fmt(v.airportStartFrom)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-white/40">Per-km rate</div>
            <div className="text-sm font-semibold text-white/70">
              ₹{v.pricePerKmFrom}–{v.pricePerKmTo}/km
            </div>
          </div>
        </div>

        <button
          onClick={() => onOpen(v)}
          className="w-full rounded-xl bg-brand-orange py-3.5 font-heading text-lg font-semibold text-white transition hover:-translate-y-0.5 hover:bg-brand-orange-dark hover:shadow-glow"
        >
          View Details &amp; Book
        </button>
      </div>

      {/* Right — visual + inclusions */}
      <div className="relative flex flex-col bg-gradient-to-br from-brand-navy to-brand-navy-mid p-8 md:p-10">
        {/* Large icon area */}
        <div className="relative mb-6 flex flex-1 items-center justify-center py-10">
          <div className="relative z-10 flex flex-col items-center gap-3">
            <div className="flex h-32 w-32 items-center justify-center rounded-3xl border border-brand-orange/15 bg-brand-orange/10">
              <Icon className="h-16 w-16 text-brand-orange" strokeWidth={1.2} />
            </div>
            {/* rating pill */}
            <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5">
              <Star className="h-3.5 w-3.5 fill-brand-orange text-brand-orange" />
              <span className="text-xs font-semibold text-white">4.9</span>
              <span className="text-[11px] text-white/40">· 2,400+ rides</span>
            </div>
          </div>
          {/* shadow */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 h-6 w-48 -translate-x-1/2 rounded-full bg-black/20 blur-xl" />
          {/* ambient glow */}
          <div className="pointer-events-none absolute inset-0 rounded-2xl bg-brand-orange/5" />
        </div>

        {/* Inclusions */}
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.04] p-5">
          <div className="mb-3.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">
            What&apos;s Included
          </div>
          <div className="grid grid-cols-2 gap-y-2.5 gap-x-3">
            {v.inclusions.map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs text-white/65">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border border-green-500/40 bg-green-500/15 text-green-400">
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Standard Vehicle Card ─────────────────────────────────────────────────────

function VehicleCard({
  vehicle: v,
  onOpen,
}: {
  vehicle: VehicleDef;
  onOpen: (v: VehicleDef) => void;
}) {
  const Icon = v.Icon;
  return (
    <div className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-sand-100 bg-white shadow-sm transition duration-300 hover:-translate-y-1.5 hover:border-brand-orange hover:shadow-[0_16px_40px_rgba(30,45,90,0.12)]">
      {/* Card top (dark) */}
      <div className="relative overflow-hidden bg-brand-navy-dark px-6 pb-7 pt-6 text-center">
        {/* top border shine on hover */}
        <span className="absolute bottom-0 left-0 right-0 h-[2px] origin-left scale-x-0 bg-brand-orange transition-transform duration-300 group-hover:scale-x-100" />
        {/* ambient glow */}
        <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-brand-orange/10 blur-2xl" />

        {v.tag && (
          <span className="relative mb-3 inline-block rounded border border-brand-orange/25 bg-brand-orange/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-orange">
            {v.tag}
          </span>
        )}

        <div className="relative mb-3 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.06]">
            <Icon className="h-8 w-8 text-brand-orange" strokeWidth={1.4} />
          </div>
        </div>

        <div className="font-heading text-[22px] font-bold text-white">{v.name}</div>
        <div className="mt-1 text-[11px] text-white/40">{v.models}</div>
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col p-6">
        {/* Meta chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { icon: Users, label: `${v.pax} pax` },
            { icon: Briefcase, label: `${v.luggageBags} bags` },
            { icon: Wind, label: v.ac },
          ].map(({ icon: MIcon, label }) => (
            <span
              key={label}
              className="flex items-center gap-1.5 rounded-md bg-sand-50 px-2.5 py-1 text-[11px] font-medium text-sand-500"
            >
              <MIcon className="h-3 w-3" />
              {label}
            </span>
          ))}
        </div>

        <p className="mb-5 text-[13px] leading-relaxed text-sand-500">{v.tagline}</p>

        {/* Price */}
        <div className="mb-4 rounded-xl bg-sand-50 p-4">
          <div className="text-[10px] uppercase tracking-wider text-sand-500">Airport trip from</div>
          <div className="mt-1 font-heading text-2xl font-bold text-brand-navy">
            {fmt(v.airportStartFrom)}
          </div>
          <div className="mt-0.5 text-xs text-sand-500">
            ₹{v.pricePerKmFrom}–{v.pricePerKmTo}/km · fixed fares
          </div>
        </div>

        {/* Perks */}
        <div className="mb-5 grid grid-cols-2 gap-y-2 gap-x-3">
          {v.perks.map((p) => (
            <div key={p} className="flex items-center gap-1.5 text-xs text-sand-500">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-orange" />
              {p}
            </div>
          ))}
        </div>

        {/* Book button — pushed to bottom */}
        <button
          onClick={() => onOpen(v)}
          className="mt-auto w-full rounded-lg bg-brand-navy py-3 font-heading text-base font-semibold text-white transition hover:bg-brand-orange"
        >
          View Details
        </button>
      </div>
    </div>
  );
}

// ── Compare Table ─────────────────────────────────────────────────────────────

function CompareTable() {
  const headers: { slug: VehicleSlug; label: string; highlight?: boolean }[] = [
    { slug: 'sedan', label: 'Sedan' },
    { slug: 'suv', label: 'SUV' },
    { slug: 'innova', label: 'Innova', highlight: true },
    { slug: 'premium', label: 'Premium' },
    { slug: 'tempo', label: 'Tempo' },
    { slug: 'minibus', label: 'Mini Bus' },
  ];

  return (
    <div className="overflow-x-auto rounded-2xl border border-sand-100 shadow-sm">
      <table className="w-full min-w-[700px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-44 bg-brand-navy-dark px-5 py-4 text-left text-xs font-semibold uppercase tracking-wider text-white/50">
              Feature
            </th>
            {headers.map((h) => (
              <th
                key={h.slug}
                className={`px-4 py-4 text-left text-sm font-semibold tracking-wide text-white ${
                  h.highlight ? 'bg-brand-orange' : 'bg-brand-navy'
                }`}
              >
                {h.label}
                {h.highlight && (
                  <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium">
                    Popular
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row, ri) => (
            <tr
              key={row.feature}
              className={ri % 2 === 0 ? 'bg-white' : 'bg-sand-50/60'}
            >
              <td className="border-b border-sand-100 px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-brand-navy">
                {row.feature}
              </td>
              {headers.map((h) => {
                const val = row[h.slug];
                return (
                  <td
                    key={h.slug}
                    className={`border-b border-sand-100 px-4 py-3.5 text-[13px] text-sand-500 ${
                      h.highlight ? 'bg-brand-orange/[0.04]' : ''
                    }`}
                  >
                    {typeof val === 'boolean' ? (
                      val ? (
                        <Check className="h-4 w-4 text-green-600" strokeWidth={2.5} />
                      ) : (
                        <X className="h-4 w-4 text-sand-200" strokeWidth={2} />
                      )
                    ) : row.feature === 'Starting ₹/km' ? (
                      <span className="font-heading text-[15px] font-bold text-brand-orange">
                        {val}
                      </span>
                    ) : (
                      val
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main FleetView ────────────────────────────────────────────────────────────

export function FleetView() {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleDef | null>(null);

  const showFeatured = activeTab === 'all' || activeTab === 'comfort';

  const filteredGrid = useMemo(() => {
    if (activeTab === 'all') return NON_FEATURED_VEHICLES;
    return NON_FEATURED_VEHICLES.filter((v) => v.category === activeTab);
  }, [activeTab]);

  // When comfort tab is active, also include featured in the grid if needed
  const gridVehicles = useMemo(() => {
    if (activeTab !== 'comfort') return filteredGrid;
    // Featured Innova is shown in the featured card above, so exclude from grid
    return filteredGrid;
  }, [activeTab, filteredGrid]);

  return (
    <>
      {/* ── PAGE HERO ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-brand-navy-dark pb-0 pt-28 md:pt-[120px]">
        {/* Background */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 opacity-[0.028] [background-image:radial-gradient(circle,white_1px,transparent_1px)] [background-size:32px_32px]" />
          <div className="absolute left-[15%] top-[80%] h-72 w-72 rounded-full bg-brand-orange/[0.06] blur-3xl" />
          <div className="absolute right-[20%] top-[35%] h-[500px] w-[500px] rounded-full bg-brand-orange/[0.08] blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto max-w-6xl px-6 md:px-12">
          {/* Breadcrumb */}
          <div className="mb-5 flex items-center gap-2 text-xs text-white/40">
            <Link href="/" className="transition hover:text-brand-orange">
              Home
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-brand-orange">Our Fleet</span>
          </div>

          <h1 className="mb-3 font-heading text-[clamp(36px,5vw,62px)] font-bold leading-[1.05] text-white">
            Choose Your Perfect{' '}
            <span className="text-brand-orange">Ride</span>
          </h1>
          <p className="mb-10 max-w-[560px] text-[15px] leading-[1.7] text-white/50">
            From solo airport sprints to 20-seat family pilgrimages — every vehicle is AC-equipped, GPS-tracked, and driven by a verified professional.
          </p>

          {/* Category Tabs */}
          <div className="flex flex-wrap gap-2 pb-12">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 rounded-lg border px-5 py-2.5 text-[13px] font-medium transition-all ${
                  activeTab === tab.key
                    ? 'border-brand-orange bg-brand-orange text-white'
                    : 'border-white/15 bg-transparent text-white/55 hover:border-brand-orange/50 hover:text-white/85'
                }`}
              >
                {tab.label}
                <span
                  className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${
                    activeTab === tab.key ? 'bg-white/25 text-white' : 'bg-white/10 text-white/50'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS BAR ─────────────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.06] bg-brand-navy-mid">
        <div className="mx-auto max-w-6xl px-6 md:px-12">
          <div className="grid grid-cols-2 gap-y-7 py-8 sm:grid-cols-3 lg:grid-cols-5">
            {FLEET_STATS.map((stat, i) => (
              <div
                key={stat.label}
                className={`flex flex-col px-1 lg:px-0 ${
                  i % 5 !== 0 ? 'lg:border-l lg:border-white/[0.08] lg:pl-7' : ''
                }`}
              >
                <span className="font-heading text-[26px] font-bold leading-none text-brand-orange">
                  <CountUp value={stat.num} />
                </span>
                <span className="mt-2 text-[12px] font-semibold leading-tight text-white/75">{stat.label}</span>
                <span className="mt-0.5 text-[11px] leading-tight text-white/35">{stat.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT ──────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-6 py-16 md:px-12 md:py-20">

        {/* Featured Vehicle */}
        {showFeatured && (
          <div className="mb-20">
            <div className="section-tag">Most Booked</div>
            <h2 className="section-title mb-2 text-brand-navy">The Fleet Favourite</h2>
            <p className="section-sub mb-8">
              The most trusted vehicle for Punjab–Delhi airport runs. Spacious, reliable, and built for early-morning long-haul comfort.
            </p>
            <FeaturedVehicleCard vehicle={FEATURED_VEHICLE} onOpen={setSelectedVehicle} />
          </div>
        )}

        {/* Vehicle Grid */}
        <div>
          <div className="section-tag">Full Fleet</div>
          <h2 className="section-title mb-2 text-brand-navy">All Vehicle Categories</h2>
          <p className="section-sub mb-8">
            Solo traveller or a family of twenty — we have a seat for every journey.
          </p>

          {gridVehicles.length === 0 ? (
            <div className="rounded-2xl border border-sand-100 bg-sand-50 py-16 text-center text-sand-500">
              No other vehicles in this category — see the featured card above.
            </div>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {gridVehicles.map((v, i) => (
                <Reveal key={v.slug} delay={(i % 3) * 90} className="h-full">
                  <VehicleCard vehicle={v} onOpen={setSelectedVehicle} />
                </Reveal>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── COMPARISON TABLE ──────────────────────────────────────────────── */}
      <section className="bg-white py-20">
        <div className="mx-auto max-w-6xl px-6 md:px-12">
          <div className="section-tag">Side by Side</div>
          <h2 className="section-title mb-2 text-brand-navy">Compare All Vehicles</h2>
          <p className="section-sub mb-10">
            Not sure which cab to book? Here&apos;s everything you need to pick the right one.
          </p>
          <CompareTable />
        </div>
      </section>

      {/* ── USE CASES ─────────────────────────────────────────────────────── */}
      <section className="bg-sand-50 py-20">
        <div className="mx-auto max-w-6xl px-6 md:px-12">
          <div className="section-tag">Pick by Purpose</div>
          <h2 className="section-title mb-2 text-brand-navy">What&apos;s Your Journey?</h2>
          <p className="section-sub mb-10">Match your travel type to the right vehicle instantly.</p>

          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {USE_CASES.map((uc, i) => {
              const UCIcon = uc.Icon;
              return (
                <Reveal key={uc.title} delay={(i % 3) * 90} className="h-full">
                  <div
                    className="group h-full rounded-2xl border border-sand-100 bg-white p-7 transition duration-250 hover:-translate-y-1 hover:border-brand-orange hover:shadow-[0_8px_32px_rgba(244,128,36,0.10)]"
                  >
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-orange/10 transition group-hover:bg-brand-orange/15">
                      <UCIcon className="h-6 w-6 text-brand-orange" />
                    </div>
                    <div className="mb-2 font-heading text-xl font-bold text-brand-navy">{uc.title}</div>
                    <p className="mb-5 text-[13px] leading-relaxed text-sand-500">{uc.desc}</p>
                    <div className="flex flex-wrap gap-2">
                      {uc.vehicles.map((vname) => (
                        <span
                          key={vname}
                          className="rounded-md border border-brand-orange/20 bg-brand-orange-light px-2.5 py-1 text-[11px] font-medium text-brand-orange"
                        >
                          {vname}
                        </span>
                      ))}
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-brand-navy-dark py-20">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-[55%] top-1/2 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-brand-orange/[0.09] blur-3xl" />
        </div>
        <div className="relative z-10 mx-auto max-w-6xl px-6 md:px-12">
          <div className="flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="mb-2.5 font-heading text-[clamp(28px,4vw,44px)] font-bold leading-[1.1] text-white">
                Ready to Book Your{' '}
                <span className="text-brand-orange">Perfect Ride?</span>
              </h2>
              <p className="max-w-[480px] text-[15px] leading-relaxed text-white/50">
                Fixed fares, zero surge pricing. Confirm your cab in under 60 seconds.
              </p>
            </div>
            <div className="flex flex-shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/#book"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-orange px-8 py-3.5 font-heading text-lg font-semibold text-white transition hover:-translate-y-0.5 hover:bg-brand-orange-dark hover:shadow-glow"
              >
                Book a Ride
              </Link>
              <Link
                href="/routes"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-transparent px-8 py-3.5 font-heading text-lg font-semibold text-white/80 transition hover:border-brand-orange hover:text-brand-orange"
              >
                View Routes
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Vehicle Detail Modal */}
      <VehicleModal vehicle={selectedVehicle} onClose={() => setSelectedVehicle(null)} />
    </>
  );
}
