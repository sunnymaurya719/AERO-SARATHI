import { ArrowRight } from 'lucide-react';

const ROUTES = [
  ['Ludhiana', 'Delhi Airport'],
  ['Chandigarh', 'Delhi Airport'],
  ['Amritsar', 'Delhi Airport'],
  ['Patiala', 'Chandigarh'],
  ['Jalandhar', 'Delhi'],
  ['Mohali', 'Ambala'],
];

export function RoutesMarquee() {
  const doubled = [...ROUTES, ...ROUTES];
  return (
    <div className="overflow-hidden bg-brand-orange py-4">
      <div className="flex w-max animate-marquee gap-12">
        {doubled.map((r, i) => (
          <div key={i} className="flex items-center gap-2 whitespace-nowrap font-heading text-[15px] font-semibold tracking-wide text-white">
            {r[0]}
            <ArrowRight className="h-4 w-4 text-white/60" />
            {r[1]}
          </div>
        ))}
      </div>
    </div>
  );
}
