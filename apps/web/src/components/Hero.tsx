import Image from 'next/image';
import { Shield, Star, MapPin } from 'lucide-react';
import { BookingWidget } from './BookingWidget';
import { CountUp } from './ui/CountUp';

const STATS = [
  { num: '500+', label: 'Happy Riders' },
  { num: '50+', label: 'Routes Covered' },
  { num: '4.8★', label: 'Avg. Rating' },
];

const TRUST = [
  { Icon: Shield, text: 'Verified Drivers' },
  { Icon: Star, text: '4.8 Rated' },
  { Icon: MapPin, text: 'GPS Tracked' },
];

export function Hero() {
  return (
    <section
      id="book"
      className="relative flex min-h-screen items-center overflow-hidden bg-brand-navy-dark pt-[72px]"
    >
      {/* ── Photo — nudged right so the people/car are in the centre-right ── */}
      <Image
        src="/route-delhi-airport.jpg"
        alt="Airport taxi transfer"
        fill
        priority
        className="object-cover"
        style={{ objectPosition: '62% 50%' , filter: 'brightness(1.2)'}}
        
      />

      {/* ── Layer 1: Directional dark scrim — heavy left, fades right ── */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(100deg, rgba(10,17,35,0.97) 0%, rgba(13,22,42,0.91) 30%, rgba(13,22,42,0.62) 56%, rgba(13,22,42,0.18) 100%)',
        }}
      />

      {/* ── Layer 2: Bottom fade — eases into the next section ── */}
      <div
        className="absolute inset-x-0 bottom-0 h-44 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(10,17,35,0.90) 0%, transparent 100%)',
        }}
      />

      {/* ── Layer 3: Orange brand glow, bottom-left ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 55% 55% at 0% 100%, rgba(244,128,36,0.16) 0%, transparent 70%)',
        }}
      />

      {/* ── Layer 4: Dot texture — masked to left half only ── */}
      <div
        className="absolute inset-0 opacity-[0.038] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          WebkitMaskImage: 'linear-gradient(90deg, black 0%, transparent 52%)',
          maskImage: 'linear-gradient(90deg, black 0%, transparent 52%)',
        }}
      />

      {/* ── Content ── */}
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-10 px-6 py-14 sm:py-20 md:grid-cols-2 md:gap-16 md:px-12">

        {/* Left — copy */}
        <div>
          {/* Badge */}
          <div className="mb-7 inline-flex animate-fadeUp items-center gap-2.5 rounded-full border border-brand-orange/25 bg-brand-orange/10 px-4 py-2 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulseDot rounded-full bg-brand-orange" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-orange">
              Punjab&apos;s Trusted Airport Taxi
            </span>
          </div>

          {/* Orange accent bar + heading */}
          <div className="animate-fadeUp">
            <span className="mb-4 block h-[3px] w-11 rounded-full bg-brand-orange" />
            <h1 className="font-heading text-[clamp(44px,5.2vw,70px)] font-bold leading-[1.02] tracking-tight text-white">
              Your Journey,
              <br />
              Our{' '}
              <span className="relative inline-block text-brand-orange">
                Mission
                <span className="absolute -bottom-1 left-0 right-0 h-[3px] rounded-full bg-brand-orange/35" />
              </span>
            </h1>
          </div>

          <p className="mb-10 mt-6 max-w-[420px] animate-fadeUp text-[15px] font-light leading-[1.8] text-white/55">
            Pre-book intercity taxis, airport transfers, and outstation rides across
            Punjab. Fixed fares, professional drivers, zero surprises.
          </p>

          {/* Stats */}
          <div className="flex animate-fadeUp items-start divide-x divide-white/10">
            {STATS.map((s) => (
              <div key={s.label} className="flex flex-col px-7 first:pl-0 last:pr-0">
                <CountUp
                  value={s.num}
                  className="font-heading text-[30px] font-bold leading-none text-brand-orange sm:text-[34px]"
                />
                <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/38">
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {/* Trust chips */}
          <div className="mt-8 flex animate-fadeUp flex-wrap gap-2.5">
            {TRUST.map(({ Icon, text }) => (
              <span
                key={text}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3.5 py-1.5 backdrop-blur-sm"
              >
                <Icon className="h-3 w-3 flex-shrink-0 text-brand-orange" strokeWidth={2} />
                <span className="text-[11px] font-medium text-white/60">{text}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Right — booking widget */}
        <div className="flex justify-center md:justify-end">
          <BookingWidget />
        </div>
      </div>
    </section>
  );
}
