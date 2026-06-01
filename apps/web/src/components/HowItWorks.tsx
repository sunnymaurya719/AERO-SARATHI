import { Map, Car, CreditCard, CheckCircle2 } from 'lucide-react';
import { Reveal } from './ui/Reveal';

const STEPS = [
  { icon: Map, title: 'Enter Route', desc: 'Enter your pickup city, destination, date and time. Get an instant fare estimate.' },
  { icon: Car, title: 'Choose Vehicle', desc: 'Pick from Hatchback, Sedan, SUV, or Luxury based on group size and budget.' },
  { icon: CreditCard, title: 'Pay Token', desc: 'Secure your booking with a small advance. Rest is paid directly to the driver.' },
  { icon: CheckCircle2, title: 'Ride Confirmed', desc: 'Driver assigned ahead of your trip. Get SMS with driver details and a tracking link.' },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-sand-50 px-6 py-24 md:px-12">
      <div className="mx-auto max-w-6xl">
        <div className="section-tag">Simple Process</div>
        <h2 className="section-title">Book in 4 Easy Steps</h2>
        <p className="section-sub mt-4">
          Pre-book your ride, get a confirmed driver, and travel stress-free across Punjab.
        </p>

        <div className="relative mt-16 grid gap-12 md:grid-cols-4 md:gap-0">
          <div className="absolute left-[10%] right-[10%] top-8 hidden h-px bg-gradient-to-r from-transparent via-brand-orange to-transparent opacity-30 md:block" />
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal key={step.title} delay={i * 110} className="relative px-6 text-center">
                <div className="relative z-10 mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border-2 border-brand-orange bg-white shadow-[0_4px_20px_rgba(244,128,36,0.15)]">
                  <Icon className="h-7 w-7 text-brand-orange" />
                </div>
                <h3 className="mb-2.5 font-heading text-lg font-semibold text-brand-navy">{step.title}</h3>
                <p className="text-sm leading-relaxed text-sand-500">{step.desc}</p>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
