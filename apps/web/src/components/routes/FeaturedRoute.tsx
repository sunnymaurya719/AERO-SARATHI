import { ArrowRight, Flame } from 'lucide-react';
import type { RouteDef } from '@/lib/routes-data';
import { formatINR } from '@/lib/places';

export function FeaturedRoute({ route, onSelect }: { route: RouteDef; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(route.id)}
      className="relative block w-full overflow-hidden rounded-2xl border border-brand-orange/15 bg-brand-navy-dark text-left transition hover:-translate-y-1 hover:shadow-[0_16px_48px_rgba(0,0,0,0.25)]"
    >
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: 'radial-gradient(circle at 30% 50%, #f48024 0%, transparent 60%)',
        }}
      />
      <span className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-full bg-brand-orange px-3 py-1 text-[11px] font-semibold text-white">
        <Flame className="h-3.5 w-3.5" /> Top Booked
      </span>

      <div className="relative z-[1] grid items-center gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:gap-8">
        <div>
          <div className="flex flex-wrap items-center gap-4 sm:gap-5">
            <div>
              <div className="font-heading text-3xl font-bold leading-none text-white sm:text-4xl">
                {route.fromCity}
              </div>
              <div className="mt-1 text-xs text-white/40">{route.fromState}</div>
            </div>
            <div className="flex flex-col items-center gap-1 px-2">
              <ArrowRight className="h-6 w-6 text-brand-orange" />
              <span className="text-[11px] text-white/40">{route.distanceKm} km</span>
            </div>
            <div>
              <div className="font-heading text-3xl font-bold leading-none text-white sm:text-4xl">
                {route.toCity}
              </div>
              <div className="mt-1 text-xs text-white/40">{route.toState}</div>
            </div>
          </div>

          <div className="mt-5 flex gap-6">
            <div>
              <div className="font-heading text-lg font-semibold leading-none text-brand-orange">
                {route.durationLabel}
              </div>
              <div className="mt-1 text-[10px] text-white/35">Duration</div>
            </div>
            <div>
              <div className="font-heading text-lg font-semibold leading-none text-brand-orange">24/7</div>
              <div className="mt-1 text-[10px] text-white/35">Availability</div>
            </div>
            <div>
              <div className="font-heading text-lg font-semibold leading-none text-brand-orange">
                {route.vehicles.length}
              </div>
              <div className="mt-1 text-[10px] text-white/35">Vehicle types</div>
            </div>
          </div>
        </div>

        <div className="text-left lg:text-right">
          <div className="text-[11px] text-white/40">from</div>
          <div className="font-heading text-4xl font-bold leading-none text-white">{formatINR(route.priceFrom)}</div>
          <div className="mt-1 text-[11px] text-white/35">all-inclusive · per trip</div>
          <span className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-orange px-7 py-3 font-heading font-semibold text-white transition hover:bg-brand-orange-dark">
            Book This Route <ArrowRight className="h-4 w-4" />
          </span>
        </div>
      </div>
    </button>
  );
}
