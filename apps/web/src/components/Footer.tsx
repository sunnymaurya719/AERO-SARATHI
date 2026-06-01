import Link from 'next/link';

const COLUMNS = [
  {
    title: 'Quick Links',
    links: [
      { label: 'Book a Ride', href: '#book' },
      { label: 'Popular Routes', href: '#routes' },
      { label: 'Our Fleet', href: '#vehicles' },
      { label: 'How It Works', href: '#how' },
      { label: 'My Bookings', href: '/account/bookings' },
    ],
  },
  {
    title: 'Top Routes',
    links: [
      { label: 'Ludhiana → Delhi', href: '#book' },
      { label: 'Chandigarh → Delhi', href: '#book' },
      { label: 'Amritsar → Delhi', href: '#book' },
      { label: 'Patiala → Chandigarh', href: '#book' },
      { label: 'Jalandhar → Delhi', href: '#book' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Contact Us', href: '#' },
      { label: 'Cancellation Policy', href: '#' },
      { label: 'Refund Policy', href: '#' },
      { label: 'Partner with Us', href: '#' },
      { label: 'Become a Driver', href: '#' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-brand-navy-dark px-6 pb-8 pt-16 text-white/50 md:px-12">
      <div className="mx-auto grid max-w-6xl gap-12 pb-12 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <div className="font-heading text-2xl font-bold tracking-wide text-white">
            AERO <span className="text-brand-orange">SARATHI</span>
          </div>
          <div className="mb-4 mt-1 text-xs tracking-[0.15em] text-brand-orange">
            YOUR JOURNEY OUR MISSION
          </div>
          <p className="max-w-xs text-sm leading-relaxed">
            Punjab&apos;s most trusted pre-booking taxi platform. Serving airport routes, intercity
            travel, and outstation rides across North India.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="mb-5 font-heading text-base font-semibold text-white">{col.title}</div>
            <ul className="flex flex-col gap-2.5">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm transition hover:text-brand-orange">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs sm:flex-row">
        <div>© {new Date().getFullYear()} Indo Chariot Pvt Ltd · Aero Sarathi · All rights reserved</div>
        <div className="flex gap-5">
          <Link href="#" className="text-white/30 transition hover:text-brand-orange">Privacy Policy</Link>
          <Link href="#" className="text-white/30 transition hover:text-brand-orange">Terms of Service</Link>
          <Link href="#" className="text-white/30 transition hover:text-brand-orange">Cookie Policy</Link>
        </div>
      </div>
    </footer>
  );
}
