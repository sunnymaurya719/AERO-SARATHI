'use client';

import { ROUTE_TYPE_META, DEPARTURE_CITIES, type RouteType } from '@/lib/routes-data';
import { Check } from 'lucide-react';

export type SortKey = 'price-asc' | 'price-desc' | 'distance-asc' | 'duration-asc' | 'popular';

export interface RouteFilters {
  types: RouteType[];
  cities: string[];
  maxFare: number;
  vehicles: string[];
  sort: SortKey;
}

const VEHICLE_OPTIONS = ['Sedan', 'SUV', 'Premium', 'Tempo'];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
  { value: 'distance-asc', label: 'Distance: Shortest' },
  { value: 'duration-asc', label: 'Duration: Fastest' },
  { value: 'popular', label: 'Most Popular' },
];

export const FARE_MIN = 80000;
export const FARE_MAX = 1200000;

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function FiltersSidebar({
  filters,
  onChange,
  onReset,
}: {
  filters: RouteFilters;
  onChange: (next: RouteFilters) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-sand-100 bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.05)]">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold text-brand-navy">Filters</h2>
        <button onClick={onReset} className="text-[11px] font-medium text-brand-orange underline">
          Reset all
        </button>
      </div>

      {/* Route type */}
      <FilterSection title="Route Type">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ROUTE_TYPE_META) as RouteType[]).map((type) => {
            const active = filters.types.includes(type);
            const Icon = ROUTE_TYPE_META[type].icon;
            return (
              <button
                key={type}
                onClick={() => onChange({ ...filters, types: toggle(filters.types, type) })}
                className={`flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-brand-orange bg-brand-orange-light text-brand-orange'
                    : 'border-sand-100 bg-sand-50 text-sand-500 hover:border-brand-orange hover:text-brand-orange'
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {ROUTE_TYPE_META[type].label}
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* Departure city */}
      <FilterSection title="Departure City">
        <div className="flex flex-wrap gap-2">
          {DEPARTURE_CITIES.map((city) => {
            const active = filters.cities.includes(city);
            return (
              <button
                key={city}
                onClick={() => onChange({ ...filters, cities: toggle(filters.cities, city) })}
                className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'border-brand-orange bg-brand-orange-light text-brand-orange'
                    : 'border-sand-100 bg-sand-50 text-sand-500 hover:border-brand-orange hover:text-brand-orange'
                }`}
              >
                {city}
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* Max fare */}
      <FilterSection title="Max Fare">
        <div className="mb-2.5 flex justify-between text-xs text-sand-500">
          <span>₹{Math.round(FARE_MIN / 100).toLocaleString('en-IN')}</span>
          <strong className="text-brand-navy">
            ₹{Math.round(filters.maxFare / 100).toLocaleString('en-IN')}
          </strong>
        </div>
        <input
          type="range"
          min={FARE_MIN}
          max={FARE_MAX}
          step={10000}
          value={filters.maxFare}
          onChange={(e) => onChange({ ...filters, maxFare: Number(e.target.value) })}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-sand-200 accent-brand-orange"
        />
      </FilterSection>

      {/* Vehicle type */}
      <FilterSection title="Vehicle Type">
        <div className="flex flex-col gap-2.5">
          {VEHICLE_OPTIONS.map((v) => {
            const active = filters.vehicles.includes(v);
            return (
              <label key={v} className="flex cursor-pointer items-center gap-2.5">
                <span
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-[1.5px] transition ${
                    active ? 'border-brand-orange bg-brand-orange' : 'border-sand-200 bg-sand-50'
                  }`}
                >
                  {active && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={active}
                  onChange={() => onChange({ ...filters, vehicles: toggle(filters.vehicles, v) })}
                />
                <span className="text-[13px] text-brand-navy">{v}</span>
              </label>
            );
          })}
        </div>
      </FilterSection>

      {/* Sort */}
      <FilterSection title="Sort By" last>
        <select
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as SortKey })}
          className="w-full cursor-pointer rounded-lg border-[1.5px] border-sand-100 bg-sand-50 px-3.5 py-2.5 text-[13px] text-brand-navy outline-none focus:border-brand-orange"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </FilterSection>
    </div>
  );
}

function FilterSection({
  title,
  children,
  last,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div className={last ? '' : 'mb-6 border-b border-sand-100 pb-6'}>
      <div className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-sand-500">{title}</div>
      {children}
    </div>
  );
}
