import { Star, Quote } from 'lucide-react';
import { Reveal } from './ui/Reveal';

const REVIEWS = [
  {
    quote: 'Booked a Ludhiana to Delhi airport ride at 4 AM. Driver was on time, car was spotless, and the fare was exactly what was quoted. Will book again.',
    name: 'Harpreet Kaur',
    route: 'Ludhiana → Delhi Airport',
    initials: 'HK',
  },
  {
    quote: 'Finally a service that confirms the driver beforehand. Got the driver details a day before my trip. No anxiety, no haggling. Highly recommend.',
    name: 'Amit Verma',
    route: 'Chandigarh → Manali',
    initials: 'AV',
  },
  {
    quote: 'Used the tempo traveller for a family pilgrimage. Spacious, comfortable, and the driver was patient and knew all the routes. Great experience.',
    name: 'Sukhdev Singh',
    route: 'Amritsar → Katra',
    initials: 'SS',
  },
];

export function Testimonials() {
  return (
    <section className="bg-sand-50 px-6 py-24 md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="section-tag">Real Reviews</div>
        <h2 className="section-title">What Riders Say</h2>
        <p className="section-sub mt-4">Thousands of journeys completed across Punjab and North India.</p>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {REVIEWS.map((r, i) => (
            <Reveal key={r.name} delay={(i % 3) * 100} className="h-full">
              <div className="relative h-full rounded-2xl border border-sand-100 bg-white p-7">
                <Quote className="absolute right-6 top-6 h-8 w-8 text-brand-orange/15" />
                <div className="mb-4 flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, si) => (
                    <Star key={si} className="h-4 w-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="mb-6 text-[15px] leading-relaxed text-brand-navy">&ldquo;{r.quote}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-brand-navy to-brand-navy-mid font-heading text-sm font-bold text-white">
                    {r.initials}
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-brand-navy">{r.name}</div>
                    <div className="text-xs text-sand-500">{r.route}</div>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
