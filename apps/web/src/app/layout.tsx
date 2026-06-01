import type { Metadata } from 'next';
import { Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import { Providers } from '@/components/Providers';
import './globals.css';

const outfit = Outfit({ subsets: ['latin'], weight: ['300', '400', '500', '600', '700', '800'], variable: '--font-rajdhani' });
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-dmsans',
});

export const metadata: Metadata = {
  title: 'Aero Sarathi — Pre-booked Airport & Intercity Taxis in Punjab',
  description:
    'Book reliable, fixed-fare taxis across Punjab, to and from the airport, and intercity. Transparent pricing, professional drivers, pay a small token to confirm.',
  openGraph: {
    title: 'Aero Sarathi',
    description: 'Pre-booked airport & intercity taxis in Punjab.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${plusJakarta.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
