import { ArrowUpRight } from 'lucide-react';

export function CityCard({
  name,
  routes,
  onSelect,
}: {
  name: string;
  routes: number;
  onSelect: (city: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(name)}
      className="group flex h-full w-full flex-col items-start rounded-2xl border border-sand-100 bg-white p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-brand-orange/50 hover:shadow-[0_14px_34px_rgba(244,128,36,0.10)]"
    >
      <span className="font-heading text-[34px] font-bold leading-none tracking-tight text-sand-200 transition-colors duration-200 group-hover:text-brand-orange/35">
        {String(routes).padStart(2, '0')}
      </span>

      <div className="mt-5 flex w-full items-end justify-between">
        <div>
          <div className="font-heading text-[15px] font-bold leading-tight text-brand-navy">{name}</div>
          <div className="mt-1 text-[11px] text-sand-500">routes available</div>
        </div>
        <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-sand-200 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-brand-orange" />
      </div>
    </button>
  );
}
