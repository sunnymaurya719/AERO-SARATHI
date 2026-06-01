import { ArrowRight, PhoneCall } from 'lucide-react';

export function CtaStrip() {
  return (
    <section className="relative overflow-hidden bg-brand-orange px-6 py-20 md:px-12">
      <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10" />
      <div className="absolute -bottom-20 -left-10 h-72 w-72 rounded-full bg-white/[0.06]" />

      <div className="relative mx-auto max-w-3xl text-center">
        <h2 className="font-heading text-3xl font-bold text-white md:text-5xl">Ready to Book Your Ride?</h2>
        <p className="mx-auto mt-4 max-w-xl text-base text-white/90 md:text-lg">
          Get an instant fare, lock in a confirmed driver, and travel across Punjab with total peace of mind.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#book"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 font-heading font-semibold text-brand-orange shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            Book My Ride Now <ArrowRight className="h-5 w-5" />
          </a>
          <a
            href="tel:+919999999999"
            className="inline-flex items-center gap-2 rounded-xl border-[1.5px] border-white/60 px-7 py-3.5 font-heading font-semibold text-white transition hover:bg-white/10"
          >
            <PhoneCall className="h-5 w-5" /> Call Us
          </a>
        </div>
      </div>
    </section>
  );
}
