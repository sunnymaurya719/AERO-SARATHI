import Link from 'next/link';
import { Navigation } from 'lucide-react';

export function Logo({ light = true }: { light?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 flex-shrink-0 -rotate-45 items-center justify-center rounded-[50%_50%_50%_0] bg-brand-orange">
        <Navigation className="h-4 w-4 rotate-45 fill-white text-white" />
      </span>
      <span className={`font-heading text-2xl font-bold tracking-wide text-brand-navy`}>
        AERO <span className="text-brand-orange">SARATHI</span>
      </span>
    </Link>
  );
}
