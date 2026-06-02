import Link from 'next/link';
import { Logo } from './Logo';

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
    <footer className="bg-[#F8F7F4] px-6 pb-8 pt-16 text-brand-navy/80 md:px-12 border-t border-brand-orange/15">
      <div className="mx-auto grid max-w-6xl gap-12 pb-12 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="max-w-xs text-sm leading-relaxed text-brand-navy/70">
            Punjab&apos;s most trusted pre-booking taxi platform. Serving airport routes, intercity
            travel, and outstation rides across North India.
          </p>
        </div>

        {COLUMNS.map((col) => (
          <div key={col.title}>
            <div className="mb-5 font-heading text-base font-semibold text-brand-navy">{col.title}</div>
            <ul className="flex flex-col gap-2.5">
              {col.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-sm transition text-brand-navy hover:text-brand-orange">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 pt-6 text-xs sm:flex-row">
        <div className="text-brand-navy/70">© {new Date().getFullYear()} Indo Chariot Pvt Ltd · Aero Sarathi · All rights reserved</div>
        <div className="flex gap-5">
          <Link href="#" className="text-brand-navy/60 transition hover:text-brand-orange">Privacy Policy</Link>
          <Link href="#" className="text-brand-navy/60 transition hover:text-brand-orange">Terms of Service</Link>
          <Link href="#" className="text-brand-navy/60 transition hover:text-brand-orange">Cookie Policy</Link>
        </div>
      </div>
    </footer>
  );
}
