import type { RouteTag } from '@/lib/routes-data';

const TAG_STYLES: Record<RouteTag['tone'], string> = {
  airport: 'bg-brand-orange-light text-brand-orange',
  intercity: 'bg-[#e8edf7] text-brand-navy',
  popular: 'bg-[#fef9c3] text-[#854d0e]',
  local: 'bg-[#dcfce7] text-[#16a34a]',
  ac: 'bg-[#f0f9ff] text-[#0369a1]',
  new: 'bg-[#fce7f3] text-[#be185d]',
};

export function RouteTagPill({ tag }: { tag: RouteTag }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${TAG_STYLES[tag.tone]}`}
    >
      {tag.label}
    </span>
  );
}
