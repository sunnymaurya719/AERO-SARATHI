'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { Logo } from './Logo';

// const LINKS = [
//   { href: '/routes', label: 'Routes' },
//   { href: '/vehicles', label: 'Vehicles' },
//   { href: '/#how', label: 'How It Works' },
//   { href: '/#why', label: 'Why Us' },
// ];
const LINKS = [
  { href: '/routes', label: 'Routes' },
  { href: '/', label: 'Vehicles' },
  { href: '/', label: 'How It Works' },
  { href: '/', label: 'Why Us' },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <nav
      className={`fixed inset-x-0 top-0 z-50 flex h-[72px] items-center justify-between px-6 transition-colors md:px-12 bg-[#F8F7F4] border-b border-brand-orange/15`}
    >
      <Logo />

      <ul className="hidden items-center gap-8 md:flex">
        {LINKS.map((l) => (
          <li key={l.href}>
            <a href={l.href} className={`text-sm font-semibold text-brand-orange`}>
              {l.label}
            </a>
          </li>
        ))}
        <li>
          <Link
            href="/account/bookings"
            className={`text-sm font-semibold text-brand-orange`}
          >
            My Bookings
          </Link>
        </li>
        <li>
          <a
            href="/#book"
            className="rounded-md bg-brand-orange px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brand-orange-dark"
          >
            Book Now
          </a>
        </li>
      </ul>

      <button
        className="text-brand-orange md:hidden"
        aria-label="Toggle menu"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile menu */}
      {open && (
        <>
          <div
            className="fixed inset-0 top-[72px] z-40 bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-x-0 top-[72px] z-50 flex flex-col gap-1 border-b border-brand-orange/15 bg-brand-navy p-4 shadow-2xl md:hidden">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-4 py-3 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                {l.label}
              </a>
            ))}
            <Link
              href="/account/bookings"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-3 text-sm text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              My Bookings
            </Link>
            <a
              href="/#book"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-lg bg-brand-orange px-4 py-3 text-center text-sm font-medium text-white transition hover:bg-brand-orange-dark"
            >
              Book Now
            </a>
          </div>
        </>
      )}
    </nav>
  );
}
