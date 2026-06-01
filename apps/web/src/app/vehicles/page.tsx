import type { Metadata } from 'next';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { FleetView } from '@/components/fleet/FleetView';

export const metadata: Metadata = {
  title: 'Our Fleet — Aero Sarathi',
  description:
    'Browse our full fleet of AC cabs for airport, intercity, and outstation travel across Punjab. Sedans, SUVs, Innova Crysta, luxury, and group vehicles — all with fixed fares.',
};

export default function VehiclesPage() {
  return (
    <main>
      <Navbar />
      <FleetView />
      <Footer />
    </main>
  );
}
