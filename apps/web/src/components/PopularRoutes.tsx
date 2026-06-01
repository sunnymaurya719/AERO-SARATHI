import Image from 'next/image';
import { MapPin, Clock, ArrowRight } from 'lucide-react';
import { Reveal } from './ui/Reveal';

interface RouteCard {
  from: string;
  to: string;
  distance: string;
  time: string;
  price: string;
  wide?: boolean;
  img: string;
  /** css object-position */
  pos?: string;
}

const ROUTES: RouteCard[] = [
  {
    from: 'Chandigarh', to: 'Delhi Airport',
    distance: '245 km', time: '~4h 30m', price: 'from ₹4,800',
    wide: true,
    img: '/route-exec-pickup.jpg', pos: '55% 30%',
  },
  {
    from: 'Amritsar', to: 'Delhi',
    distance: '450 km', time: '~7h 30m', price: 'from ₹8,500',
    img: '/route-luxury-tarmac.jpg', pos: '60% 50%',
  },
  {
    from: 'Ludhiana', to: 'Delhi Airport',
    distance: '310 km', time: '~5h 30m', price: 'from ₹6,200',
    img: '/route-family-suv.jpg', pos: '50% 40%',
  },
  {
    from: 'Patiala', to: 'Chandigarh',
    distance: '65 km', time: '~1h 30m', price: 'from ₹1,400',
    img: '/route-limo-terminal.jpg', pos: '50% 50%',
  },
  {
    from: 'Jalandhar', to: 'Delhi',
    distance: '380 km', time: '~6h 30m', price: 'from ₹7,400',
    img: '/route-delhi-airport.jpg', pos: '62% 50%',
  },
];

export function PopularRoutes() {
  return (
    <section id="routes" className="bg-white px-6 py-24 md:px-12">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-12 flex items-end justify-between">
          <div>
            <div className="section-tag">Top Routes</div>
            <h2 className="section-title">Popular Destinations</h2>
          </div>
          <a
            href="/routes"
            className="flex items-center gap-1.5 text-sm font-medium text-brand-orange transition hover:gap-2.5 hover:underline"
          >
            View All Routes <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        {/* Bento grid */}
        <div className="grid auto-rows-[220px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ROUTES.map((r, i) => (
            <Reveal
              key={`${r.from}-${r.to}`}
              delay={(i % 3) * 90}
              className={`h-full ${r.wide ? 'sm:col-span-2' : ''}`}
            >
              <a
                href="#book"
                className="group relative block h-full overflow-hidden rounded-2xl transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_24px_56px_rgba(10,17,35,0.32)]"
              >
              {/* Photo */}
              <Image
                src={r.img}
                alt={`${r.from} to ${r.to}`}
                fill
                className="object-cover transition duration-500 group-hover:scale-105"
                style={{ objectPosition: r.pos ?? '50% 50%' }}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              />

              {/* Dark scrim — stronger at bottom where content lives */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(to top, rgba(8,14,28,0.92) 0%, rgba(8,14,28,0.55) 45%, rgba(8,14,28,0.18) 100%)',
                }}
              />

              {/* Hover orange glow */}
              <div className="absolute inset-0 bg-brand-orange/0 transition duration-300 group-hover:bg-brand-orange/[0.07]" />

              {/* Content */}
              <div className="relative flex h-full flex-col justify-end p-6">
                {/* Distance pill */}
                <div className="mb-3 flex w-fit items-center gap-1.5 rounded-full border border-brand-orange/40 bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-brand-orange backdrop-blur-sm">
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  {r.distance}
                </div>

                {/* Route name */}
                <div className="mb-2.5 font-heading text-[22px] font-bold leading-tight text-white drop-shadow-md">
                  {r.from}
                  <span className="mx-2 font-light text-white/45">→</span>
                  {r.to}
                </div>

                {/* Price + time */}
                <div className="flex items-center justify-between">
                  <span className="font-heading text-lg font-bold text-brand-orange drop-shadow">
                    {r.price}
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-[11px] text-white/65 backdrop-blur-sm">
                    <Clock className="h-3 w-3" />
                    {r.time}
                  </span>
                </div>
              </div>

              {/* Bottom orange border on hover */}
              <span className="absolute inset-x-0 bottom-0 h-[2px] origin-left scale-x-0 bg-brand-orange transition-transform duration-300 group-hover:scale-x-100" />
            </a>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
