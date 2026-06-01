import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { RoutesView } from '@/components/routes/RoutesView';

export const metadata: Metadata = {
  title: 'All Routes — Aero Sarathi',
  description:
    'Browse pre-bookable airport, intercity, and outstation taxi routes across Punjab and North India with fixed, transparent fares.',
};

export default function RoutesPage() {
  return (
    <main>
      <Navbar />
      <RoutesView />
      <Footer />
    </main>
  );
}
