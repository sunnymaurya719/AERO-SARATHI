import { ShieldCheck, IndianRupee, UserCheck, Headphones, Plane, Star } from 'lucide-react';
import { Reveal } from './ui/Reveal';
import { CountUp } from './ui/CountUp';

const FEATURES = [
  { icon: ShieldCheck, title: 'Confirmed Before You Travel', desc: 'Driver assigned and shared with you ahead of every trip — no last-minute cancellations.' },
  { icon: IndianRupee, title: 'Transparent Fixed Fares', desc: 'Know your exact fare upfront. No surge, no hidden charges, ever.' },
  { icon: UserCheck, title: 'Verified, Trained Drivers', desc: 'Background-checked professionals who know the routes across Punjab and North India.' },
  { icon: Headphones, title: '24/7 Human Support', desc: 'Real people on call before, during, and after your journey.' },
];

export function WhyUs() {
  return (
    <section id="why" className="bg-white px-6 py-24 md:px-12">
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-2 lg:gap-20">
        <div>
          <div className="section-tag">Why Choose Us</div>
          <h2 className="section-title">The Aero Sarathi Difference</h2>
          <p className="section-sub mt-4">
            We&apos;re not just another taxi aggregator. We&apos;re building Punjab&apos;s most reliable travel
            platform — with an owned fleet, trained drivers, and transparent pricing.
          </p>

          <div className="mt-10 flex flex-col gap-3">
            {FEATURES.map((f, i) => {
              const Icon = f.icon;
              return (
                <Reveal key={f.title} delay={i * 90}>
                  <div className="flex items-start gap-5 rounded-xl p-4 transition hover:bg-sand-50">
                    <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border border-brand-orange/20 bg-brand-orange-light">
                      <Icon className="h-5 w-5 text-brand-orange" />
                    </span>
                    <div>
                      <div className="mb-1.5 font-heading text-[17px] font-semibold text-brand-navy">{f.title}</div>
                      <p className="text-sm leading-relaxed text-sand-500">{f.desc}</p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>

        {/* Live trip visual */}
        <Reveal delay={120} className="relative">
          <div className="absolute -right-5 -top-4 z-10 rounded-xl bg-brand-orange px-5 py-3 text-white shadow-glow">
            <CountUp value="4.8★" className="font-heading text-2xl font-bold leading-none" />
            <div className="mt-0.5 text-[10px] opacity-85">Avg. Rating</div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-brand-navy p-10">
            <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-brand-orange/[0.08]" />
            <div className="absolute -bottom-14 -left-8 h-40 w-40 rounded-full bg-brand-orange/[0.05]" />

            <div className="relative">
              <div className="mb-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-orange">
                <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-green-500" /> Live Trip
              </div>

              <div className="mb-4 rounded-2xl border border-white/[0.08] bg-white/[0.06] p-5">
                <div className="mb-4 flex items-center gap-3">
                  <div>
                    <div className="font-heading text-xl font-bold text-white">Ludhiana</div>
                    <div className="text-[11px] text-white/40">Pickup</div>
                  </div>
                  <div className="flex flex-1 items-center">
                    <span className="h-px flex-1 bg-brand-orange/30" />
                    <Plane className="mx-1 h-4 w-4 text-brand-orange" />
                    <span className="h-px flex-1 bg-brand-orange/30" />
                  </div>
                  <div className="text-right">
                    <div className="font-heading text-xl font-bold text-white">Delhi</div>
                    <div className="text-[11px] text-white/40">Airport</div>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div>
                    <div className="font-heading text-base font-semibold text-brand-orange">310 km</div>
                    <div className="mt-0.5 text-[10px] text-white/40">Distance</div>
                  </div>
                  <div>
                    <div className="font-heading text-base font-semibold text-brand-orange">~5h 30m</div>
                    <div className="mt-0.5 text-[10px] text-white/40">Duration</div>
                  </div>
                  <div>
                    <div className="font-heading text-base font-semibold text-brand-orange">₹6,200</div>
                    <div className="mt-0.5 text-[10px] text-white/40">Fixed Fare</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3.5 rounded-xl border border-white/[0.06] bg-white/[0.04] p-4">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-orange to-brand-orange-dark font-heading text-lg font-bold text-white">
                  RS
                </span>
                <div>
                  <div className="mb-0.5 text-sm font-medium text-white">Rajan Singh</div>
                  <div className="flex items-center gap-1 text-xs text-white/50">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> 4.9 · Innova Crysta
                  </div>
                </div>
                <span className="ml-auto rounded-full bg-green-500/15 px-2.5 py-1 text-[11px] font-medium text-green-400">
                  En route
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
