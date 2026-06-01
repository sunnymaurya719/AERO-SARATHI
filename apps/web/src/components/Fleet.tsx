import { Car, Truck, Crown, Users } from 'lucide-react';
import { Reveal } from './ui/Reveal';

const FLEET = [
  { icon: Car, tag: 'Most Popular', name: 'Hatchback / Sedan', desc: 'Swift Dzire / Honda Amaze. Up to 4 passengers. Ideal for couples and small families.', rate: '₹12–14/km', sub: 'Fixed intercity fare' },
  { icon: Users, tag: 'Best for Groups', name: 'SUV', desc: 'Innova Crysta / Ertiga. Up to 6 passengers. Spacious with luggage for airport trips.', rate: '₹18–22/km', sub: 'Fixed intercity fare' },
  { icon: Crown, tag: 'Premium', name: 'Luxury SUV', desc: 'Toyota Fortuner / Mahindra XUV700. Pure luxury. Up to 6 passengers.', rate: '₹25–30/km', sub: 'Fixed intercity fare' },
  { icon: Truck, tag: 'Corporate / Events', name: 'Tempo Traveller', desc: 'Up to 12 passengers. Perfect for corporate groups, pilgrimages, and family trips.', rate: '₹30–35/km', sub: 'Fixed intercity fare' },
];

export function Fleet() {
  return (
    <section id="vehicles" className="bg-brand-navy-dark px-6 py-24 md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="section-tag">Our Fleet</div>
        <h2 className="section-title text-white">Choose Your Ride</h2>
        <p className="section-sub mt-4 text-white/50">
          Comfortable, clean, and well-maintained vehicles for every type of journey.
        </p>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FLEET.map((v, i) => {
            const Icon = v.icon;
            return (
              <Reveal key={v.name} delay={(i % 4) * 80} className="h-full">
                <div
                  className="group relative h-full overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] p-7 text-center transition hover:-translate-y-1 hover:border-brand-orange/30 hover:bg-brand-orange/[0.08]"
                >
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 origin-left scale-x-0 bg-brand-orange transition-transform group-hover:scale-x-100" />
                  <span className="mb-3 inline-block rounded-full bg-brand-orange/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-brand-orange">
                    {v.tag}
                  </span>
                  <Icon className="mx-auto mb-4 h-11 w-11 text-brand-orange" strokeWidth={1.5} />
                  <div className="mb-2 font-heading text-lg font-semibold text-white">{v.name}</div>
                  <p className="mb-4 text-xs leading-relaxed text-white/40">{v.desc}</p>
                  <div className="font-heading text-xl font-bold text-brand-orange">{v.rate}</div>
                  <div className="mt-0.5 text-[11px] text-white/30">{v.sub}</div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
