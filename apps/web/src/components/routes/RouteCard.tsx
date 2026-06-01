import { Car, Circle, Clock } from 'lucide-react';
import type { RouteDef } from '@/lib/routes-data';
import { ROUTE_TYPE_META } from '@/lib/routes-data';
import { formatINR } from '@/lib/places';
import { RouteTagPill } from './RouteTagPill';

const ACCENT: Record<RouteDef['type'], string> = {
  airport: 'from-brand-orange to-brand-orange-dark',
  intercity: 'from-brand-navy to-brand-navy-mid',
  local: 'from-[#16a34a] to-[#15803d]',
  outstation: 'from-[#7c3aed] to-[#5b21b6]',
};

export function RouteCard({ route, onSelect }: { route: RouteDef; onSelect: (id: string) => void }) {
  const ModeIcon = ROUTE_TYPE_META[route.type].icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(route.id)}
      className="group block w-full overflow-hidden rounded-2xl border border-sand-100 bg-white text-left shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition hover:-translate-y-0.5 hover:border-brand-orange/40 hover:shadow-[0_8px_32px_rgba(244,128,36,0.12)]"
    >
      <div className="grid grid-cols-[6px_1fr] sm:grid-cols-[6px_1fr_auto]">
        <span className={`bg-gradient-to-b ${ACCENT[route.type]}`} />

        {/* Body */}
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2">
            <div className="min-w-[88px]">
              <div className="font-heading text-xl font-bold leading-none text-brand-navy">{route.fromCity}</div>
              <div className="mt-1 text-[11px] tracking-wide text-sand-500">{route.fromState}</div>
            </div>

            <div className="flex flex-1 flex-col items-center px-2">
              <div className="flex w-full items-center gap-1">
                <Circle className="h-2 w-2 flex-shrink-0 fill-brand-orange text-brand-orange" />
                <span className="relative h-px flex-1 bg-sand-200">
                  <span className="absolute left-1/2 top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-sand-200 bg-sand-50">
                    <ModeIcon className="h-3 w-3 text-brand-orange" />
                  </span>
                </span>
                <Circle className="h-2 w-2 flex-shrink-0 fill-brand-navy text-brand-navy" />
              </div>
              <div className="mt-1.5 text-[11px] text-sand-500">{route.distanceKm} km</div>
              <div className="text-[11px] text-sand-500/70">{route.durationLabel}</div>
            </div>

            <div className="min-w-[88px] text-right">
              <div className="font-heading text-xl font-bold leading-none text-brand-navy">{route.toCity}</div>
              <div className="mt-1 text-[11px] tracking-wide text-sand-500">{route.toState}</div>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {route.tags.map((t) => (
              <RouteTagPill key={t.label} tag={t} />
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {route.vehicles.map((v) => (
              <span
                key={v}
                className="flex items-center gap-1.5 rounded-lg border border-sand-100 bg-sand-50 px-2.5 py-1 text-[11px] text-sand-500"
              >
                <Car className="h-3 w-3" /> {v}
              </span>
            ))}
          </div>
        </div>

        {/* Right price panel */}
        <div className="col-span-2 flex flex-row items-center justify-between gap-3 border-t border-sand-100 bg-sand-50 px-5 py-4 sm:col-span-1 sm:min-w-[180px] sm:flex-col sm:items-end sm:justify-between sm:border-l sm:border-t-0 sm:px-6 sm:py-6">
          <div className="text-left sm:text-right">
            <div className="text-[10px] uppercase tracking-wide text-sand-500">from</div>
            <div className="font-heading text-2xl font-bold leading-none text-brand-navy sm:text-[28px]">
              {formatINR(route.priceFrom)}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[#16a34a] sm:justify-end">
              <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-[#16a34a]" /> Available now
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-xl bg-brand-orange px-5 py-2.5 font-heading text-sm font-semibold text-white transition group-hover:bg-brand-orange-dark sm:w-full sm:justify-center">
            <Clock className="h-4 w-4" /> View & Book
          </span>
        </div>
      </div>
    </button>
  );
}
