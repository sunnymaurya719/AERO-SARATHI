import { titleCase } from '@/lib/format';

const COLORS: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  CONFIRMED: 'bg-blue-50 text-blue-700 ring-blue-200',
  DRIVER_ASSIGNED: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  EN_ROUTE: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  ONGOING: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  COMPLETED: 'bg-green-50 text-green-700 ring-green-200',
  CANCELLED: 'bg-red-50 text-red-700 ring-red-200',
  NO_SHOW: 'bg-red-50 text-red-700 ring-red-200',
  ACTIVE: 'bg-green-50 text-green-700 ring-green-200',
  ONBOARDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  SUSPENDED: 'bg-red-50 text-red-700 ring-red-200',
  OFFBOARDING: 'bg-orange-50 text-orange-700 ring-orange-200',
  DISABLED: 'bg-gray-100 text-gray-600 ring-gray-200',
  MAINTENANCE: 'bg-amber-50 text-amber-700 ring-amber-200',
  RETIRED: 'bg-gray-100 text-gray-600 ring-gray-200',
  PROCESSED: 'bg-green-50 text-green-700 ring-green-200',
  FAILED: 'bg-red-50 text-red-700 ring-red-200',
  CREATED: 'bg-blue-50 text-blue-700 ring-blue-200',
};

export function StatusPill({ status }: { status: string }) {
  const color = COLORS[status] ?? 'bg-sand-100 text-sand-500 ring-sand-200';
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${color}`}>
      {titleCase(status)}
    </span>
  );
}
