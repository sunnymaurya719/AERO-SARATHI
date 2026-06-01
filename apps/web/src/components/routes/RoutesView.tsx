'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronRight, SlidersHorizontal, Star, MapPinned, Building2, Plane, Car } from 'lucide-react';
import { ROUTES, POPULAR_CITIES, ROUTE_TYPE_META, type RouteDef, type RouteType } from '@/lib/routes-data';
import { useBookingStore } from '@/store/booking';
import { PRESET_PLACES } from '@/lib/places';
import {
  FiltersSidebar,
  type RouteFilters,
  FARE_MAX,
} from './FiltersSidebar';
import { RouteCard } from './RouteCard';
import { FeaturedRoute } from './FeaturedRoute';
import { CityCard } from './CityCard';
import { RouteModal } from './RouteModal';
import { CountUp } from '../ui/CountUp';
import { Reveal } from '../ui/Reveal';

const DEFAULT_FILTERS: RouteFilters = {
  types: ['airport', 'intercity', 'local', 'outstation'],
  cities: [],
  maxFare: FARE_MAX,
  vehicles: [],
  sort: 'price-asc',
};

const HERO_STATS = [
  { icon: MapPinned, num: '48+', label: 'Total Routes' },
  { icon: Building2, num: '12', label: 'Cities Covered' },
  { icon: Plane, num: '4', label: 'Airport Links' },
  { icon: Car, num: '4', label: 'Vehicle Types' },
];

const SECTION_ORDER: { type: RouteType; label: string }[] = [
  { type: 'airport', label: 'Airport Routes' },
  { type: 'intercity', label: 'Intercity Punjab Routes' },
  { type: 'local', label: 'Local Routes' },
  { type: 'outstation', label: 'Outstation Routes' },
];

export function RoutesView() {
  const router = useRouter();
  const setTrip = useBookingStore((s) => s.setTrip);

  const [filters, setFilters] = useState<RouteFilters>(DEFAULT_FILTERS);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<RouteDef | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filtered = useMemo(() => {
    const text = (s: string) => s.toLowerCase();
    let list = ROUTES.filter((r) => {
      if (!filters.types.includes(r.type)) return false;
      if (filters.cities.length && !filters.cities.includes(r.fromCity)) return false;
      if (r.priceFrom > filters.maxFare) return false;
      if (filters.vehicles.length && !filters.vehicles.some((v) => r.vehicles.includes(v))) return false;
      if (from && !text(r.fromCity).includes(text(from))) return false;
      if (to && !text(r.toCity).includes(text(to))) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      switch (filters.sort) {
        case 'price-desc':
          return b.priceFrom - a.priceFrom;
        case 'distance-asc':
          return a.distanceKm - b.distanceKm;
        case 'duration-asc':
          return a.distanceKm - b.distanceKm;
        case 'popular':
          return Number(b.featured ?? false) - Number(a.featured ?? false);
        default:
          return a.priceFrom - b.priceFrom;
      }
    });
    return list;
  }, [filters, from, to]);

  const featured = filtered.find((r) => r.featured);
  const grouped = SECTION_ORDER.map((section) => ({
    ...section,
    routes: filtered.filter((r) => r.type === section.type && r.id !== featured?.id),
  })).filter((g) => g.routes.length > 0);

  function handleBook(route: RouteDef) {
    // Map the route endpoints onto the nearest preset place for the booking flow.
    const pickup = PRESET_PLACES.find((p) => p.address.includes(route.fromCity)) ?? PRESET_PLACES[1]!;
    const drop = PRESET_PLACES.find((p) => p.address.includes(route.toCity.split(' ')[0]!)) ?? PRESET_PLACES[0]!;
    const scheduledAt = new Date(Date.now() + 3 * 3600_000).toISOString();
    setTrip(pickup, drop, scheduledAt);
    setSelected(null);
    router.push('/#book');
  }

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden bg-brand-navy-dark px-6 pt-[112px] md:px-12">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 80% 50%, rgba(244,128,36,0.1) 0%, transparent 55%), radial-gradient(circle at 10% 90%, rgba(244,128,36,0.06) 0%, transparent 40%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '32px 32px' }}
        />

        <div className="relative z-[1] mx-auto max-w-6xl">
          <nav className="mb-5 flex items-center gap-2 text-xs text-white/40">
            <Link href="/" className="transition hover:text-brand-orange">
              Home
            </Link>
            <ChevronRight className="h-3 w-3 text-white/20" />
            <span className="text-brand-orange">All Routes</span>
          </nav>

          <h1 className="animate-fadeUp font-heading text-[clamp(34px,5vw,60px)] font-bold leading-[1.05] text-white">
            All Routes Across <span className="text-brand-orange">Punjab</span> & Beyond
          </h1>
          <p className="mt-3 max-w-xl animate-fadeUp text-[15px] leading-relaxed text-white/50">
            Pre-book intercity taxis, airport transfers, and outstation rides. Fixed fares, confirmed drivers, zero
            surprises.
          </p>

          {/* Search bar */}
          <div className="relative z-10 mt-9 -mb-7 flex max-w-3xl animate-fadeUp flex-col gap-2 rounded-2xl bg-white p-2 shadow-[0_16px_48px_rgba(0,0,0,0.3)] sm:flex-row sm:items-center sm:gap-0 sm:pl-5">
            <div className="flex-1 border-sand-100 px-3 py-2 sm:border-r">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sand-500">From</div>
              <input
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="Ludhiana, Chandigarh…"
                className="w-full bg-transparent text-sm font-medium text-brand-navy outline-none placeholder:font-normal placeholder:text-sand-500/70"
              />
            </div>
            <div className="flex-1 px-3 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-sand-500">To</div>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Delhi Airport, Amritsar…"
                className="w-full bg-transparent text-sm font-medium text-brand-navy outline-none placeholder:font-normal placeholder:text-sand-500/70"
              />
            </div>
            <button className="flex items-center justify-center gap-2 rounded-xl bg-brand-orange px-6 py-3.5 font-heading font-semibold text-white transition hover:bg-brand-orange-dark">
              <Search className="h-4 w-4" /> Search Routes
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="relative z-[1] mt-14 border-t border-white/[0.06]">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-y-8 py-9 pt-12 sm:grid-cols-4">
            {HERO_STATS.map((s, i) => (
              <div
                key={s.label}
                className={`flex items-center gap-3.5 px-1 sm:px-0 ${
                  i !== 0 ? 'sm:border-l sm:border-white/[0.08] sm:pl-8' : ''
                }`}
              >
                <s.icon className="h-7 w-7 flex-shrink-0 text-brand-orange" strokeWidth={1.5} />
                <div>
                  <CountUp value={s.num} className="font-heading text-[26px] font-bold leading-none text-white" />
                  <div className="mt-1.5 text-[11px] tracking-wide text-white/45">{s.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MAIN LAYOUT */}
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:px-12 lg:grid-cols-[260px_1fr] lg:py-14">
        {/* Mobile filter toggle */}
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="btn-secondary w-full lg:hidden"
        >
          <SlidersHorizontal className="h-4 w-4" /> {filtersOpen ? 'Hide Filters' : 'Show Filters'}
        </button>

        <aside className={`${filtersOpen ? 'block' : 'hidden'} lg:sticky lg:top-[88px] lg:block lg:self-start`}>
          <FiltersSidebar filters={filters} onChange={setFilters} onReset={() => setFilters(DEFAULT_FILTERS)} />
        </aside>

        <div>
          <div className="mb-6 flex items-center justify-between border-b border-sand-100 pb-4">
            <p className="text-sm text-sand-500">
              Showing <strong className="font-semibold text-brand-navy">{filtered.length} routes</strong>
              <span className="hidden sm:inline"> across Punjab &amp; North India</span>
            </p>
            <span className="hidden text-[11px] uppercase tracking-[0.16em] text-sand-500/70 sm:block">
              Fixed fares · all-inclusive
            </span>
          </div>

          {filtered.length === 0 && (
            <div className="rounded-2xl border border-sand-100 bg-white p-12 text-center">
              <p className="font-heading text-lg font-semibold text-brand-navy">No routes match your filters</p>
              <p className="mt-2 text-sm text-sand-500">Try widening the fare range or selecting more route types.</p>
              <button onClick={() => setFilters(DEFAULT_FILTERS)} className="btn-primary mt-5">
                Reset filters
              </button>
            </div>
          )}

          {featured && (
            <>
              <SectionLabel icon={<Star className="h-3.5 w-3.5 fill-brand-orange" />}>Most Booked Route</SectionLabel>
              <FeaturedRoute route={featured} onSelect={(id) => setSelected(ROUTES.find((r) => r.id === id) ?? null)} />
            </>
          )}

          {grouped.map((group) => {
            const Icon = ROUTE_TYPE_META[group.type].icon;
            return (
              <div key={group.type}>
                <SectionLabel icon={<Icon className="h-3.5 w-3.5" />}>{group.label}</SectionLabel>
                <div className="flex flex-col gap-4">
                  {group.routes.map((route, i) => (
                    <Reveal key={route.id} delay={Math.min(i, 4) * 70}>
                      <RouteCard
                        route={route}
                        onSelect={(id) => setSelected(ROUTES.find((r) => r.id === id) ?? null)}
                      />
                    </Reveal>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* POPULAR CITIES */}
      <section className="border-t border-sand-100 px-6 py-20 md:px-12">
        <div className="mx-auto max-w-6xl">
          <div className="mb-9">
            <div className="section-tag">By City</div>
            <h2 className="font-heading text-2xl font-bold text-brand-navy md:text-3xl">Browse by Departure City</h2>
            <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-sand-500">
              Pick your starting point — we run fixed-fare rides from every major city across Punjab and the
              neighbouring states.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {POPULAR_CITIES.map((c, i) => (
              <Reveal key={c.name} delay={(i % 6) * 60} className="h-full">
                <CityCard
                  name={c.name}
                  routes={c.routes}
                  onSelect={(city) => {
                    setFrom(city);
                    setFilters((f) => ({ ...f, cities: [city] }));
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <RouteModal route={selected} onClose={() => setSelected(null)} onBook={handleBook} />
    </>
  );
}

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-4 mt-8 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-orange first:mt-0">
      <span className="flex items-center gap-1.5">{icon}</span>
      {children}
      <span className="h-px flex-1 bg-sand-100" />
    </div>
  );
}
