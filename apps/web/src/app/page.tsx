import { Navbar } from '@/components/Navbar';
import { Hero } from '@/components/Hero';
import { RoutesMarquee } from '@/components/RoutesMarquee';
import { TrustStrip } from '@/components/TrustStrip';
import { HowItWorks } from '@/components/HowItWorks';
import { PopularRoutes } from '@/components/PopularRoutes';
import { Fleet } from '@/components/Fleet';
import { WhyUs } from '@/components/WhyUs';
import { Testimonials } from '@/components/Testimonials';
import { CtaStrip } from '@/components/CtaStrip';
import { Footer } from '@/components/Footer';

export default function HomePage() {
  return (
    <main>
      <Navbar />
      <Hero />
      <RoutesMarquee />
      <TrustStrip />
      <HowItWorks />
      <PopularRoutes />
      <Fleet />
      <WhyUs />
      <Testimonials />
      <CtaStrip />
      <Footer />
    </main>
  );
}
