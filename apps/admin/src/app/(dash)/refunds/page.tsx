'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listRefunds, reconcileRefund } from '@/lib/data';
import { DataTable } from '@/components/DataTable';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PermissionGate } from '@/components/PermissionGate';
import { formatINR, formatDateTime } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { AdminRefundRow } from '@aero/types';

const STATUSES = ['CREATED', 'PENDING', 'PROCESSED', 'FAILED'];

export default function RefundsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['refunds', status], queryFn: () => listRefunds({ status: status || undefined }) });

  const reconcile = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => reconcileRefund(id, note),
    onSuccess: () => { toast.success('Refund reconciled'); qc.invalidateQueries({ queryKey: ['refunds'] }); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail ?? 'Failed' : 'Failed'),
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Refunds</h1>

      <select className="input max-w-[200px]" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All statuses</option>
        {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
      </select>

      {isLoading ? (
        <p className="text-sand-500">Loading…</p>
      ) : (
        <DataTable<AdminRefundRow>
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          columns={[
            { header: 'Amount', cell: (r) => formatINR(r.amount) },
            { header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
            { header: 'Reason', cell: (r) => r.reason },
            { header: 'Gateway ref', cell: (r) => r.gatewayRefundId ?? '—' },
            { header: 'Created', cell: (r) => formatDateTime(r.createdAt) },
            {
              header: '',
              cell: (r) =>
                r.status !== 'PROCESSED' ? (
                  <PermissionGate permission="refunds.reconcile">
                    <ConfirmDialog
                      title="Reconcile refund?"
                      description="Mark this refund as processed manually. Use only after verifying the gateway dashboard."
                      confirmLabel="Reconcile"
                      requireReason
                      onConfirm={(note) => reconcile.mutateAsync({ id: r.id, note })}
                      trigger={(open) => <button className="btn-secondary" onClick={open}>Reconcile</button>}
                    />
                  </PermissionGate>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  );
}
