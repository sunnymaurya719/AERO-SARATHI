'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAudit } from '@/lib/data';
import { DataTable } from '@/components/DataTable';
import { formatDateTime, titleCase } from '@/lib/format';
import type { AuditEventRow } from '@aero/types';

export default function AuditPage() {
  const [filters, setFilters] = useState<{ entityType?: string; action?: string }>({});
  const { data, isLoading } = useQuery({ queryKey: ['audit', filters], queryFn: () => listAudit(filters) });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Audit Log</h1>

      <div className="flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Entity type (e.g. Booking)" value={filters.entityType ?? ''} onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value || undefined }))} />
        <input className="input max-w-xs" placeholder="Action (e.g. refund.issue)" value={filters.action ?? ''} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value || undefined }))} />
      </div>

      {isLoading ? (
        <p className="text-sand-500">Loading…</p>
      ) : (
        <DataTable<AuditEventRow>
          rows={(data?.items ?? []) as AuditEventRow[]}
          rowKey={(r) => r.id}
          columns={[
            { header: 'When', cell: (r) => formatDateTime(r.at) },
            { header: 'Action', cell: (r) => <span className="font-medium">{titleCase(r.action)}</span> },
            { header: 'Entity', cell: (r) => `${r.entityType} · ${r.entityId}` },
            { header: 'Actor', cell: (r) => r.actorEmail ?? r.actorId },
            { header: 'Reason', cell: (r) => r.reason ?? '—' },
          ]}
        />
      )}
    </div>
  );
}
