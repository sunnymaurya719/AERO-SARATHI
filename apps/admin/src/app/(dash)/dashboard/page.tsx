'use client';

import { useQuery } from '@tanstack/react-query';
import { getDashboard } from '@/lib/data';
import { formatINR } from '@/lib/format';

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card group relative overflow-hidden transition-shadow hover:shadow-glow/30">
      <span className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-orange to-brand-orange-dark opacity-0 transition-opacity group-hover:opacity-100" />
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-sand-500">{label}</p>
      <p className="mt-2 font-heading text-3xl font-bold text-brand-navy">{value}</p>
    </div>
  );
}

const ALERT_LABELS: Record<string, string> = {
  unassigned_t_minus_30: 'Unassigned booking near pickup',
  refund_stuck: 'Refund stuck in pending',
  webhook_dlq: 'Webhooks in dead-letter',
  doc_expiry: 'Driver document expiring',
};

export default function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: getDashboard, refetchInterval: 30_000 });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Dashboard</h1>

      {isLoading || !data ? (
        <p className="text-sand-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Kpi label="Bookings today" value={String(data.today.bookingsCount)} />
            <Kpi label="Revenue today" value={formatINR(data.today.revenue)} />
            <Kpi label="Cancellations" value={String(data.today.cancellations)} />
            <Kpi label="Refunds today" value={formatINR(data.today.refundsAmount)} />
            <Kpi label="Pending assignment" value={String(data.today.pendingAssignment)} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="card lg:col-span-2">
              <h2 className="mb-3 font-heading text-lg font-bold text-brand-navy">Alerts</h2>
              {data.alerts.length === 0 ? (
                <p className="text-sm text-sand-500">No active alerts.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {data.alerts.map((a, i) => {
                    const alert = a as unknown as Record<string, unknown>;
                    const type = String(alert.type ?? alert.kind ?? 'alert');
                    return (
                      <li key={i} className="flex items-center justify-between rounded-lg border border-sand-100 px-3 py-2">
                        <span className="font-medium text-brand-navy">{ALERT_LABELS[type] ?? type}</span>
                        <span className="text-sand-500">{String(alert.code ?? alert.count ?? alert.message ?? '')}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card">
              <h2 className="mb-3 font-heading text-lg font-bold text-brand-navy">Queue depth</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span>Webhooks</span><span className="font-semibold">{data.queueDepth.webhooks}</span></div>
                <div className="flex justify-between"><span>Notifications</span><span className="font-semibold">{data.queueDepth.notifications}</span></div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
