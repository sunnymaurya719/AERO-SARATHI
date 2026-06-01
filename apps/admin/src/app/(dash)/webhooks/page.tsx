'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listWebhooks, getWebhook, replayWebhook } from '@/lib/data';
import { DataTable } from '@/components/DataTable';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PermissionGate } from '@/components/PermissionGate';
import { formatDateTime } from '@/lib/format';
import { ApiError } from '@/lib/api';

export default function WebhooksPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: () => listWebhooks({}) });
  const { data: detail } = useQuery({ queryKey: ['webhook', selected], queryFn: () => getWebhook(selected!), enabled: !!selected });

  const replay = useMutation({
    mutationFn: (id: string) => replayWebhook(id),
    onSuccess: () => { toast.success('Webhook re-enqueued'); qc.invalidateQueries({ queryKey: ['webhooks'] }); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail ?? 'Failed' : 'Failed'),
  });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Webhook Inspector</h1>

      {isLoading ? (
        <p className="text-sand-500">Loading…</p>
      ) : (
        <DataTable<Record<string, unknown>>
          rows={data?.items ?? []}
          rowKey={(r) => String(r.id)}
          onRowClick={(r) => setSelected(String(r.id))}
          columns={[
            { header: 'Event type', cell: (r) => <span className="font-mono">{String(r.eventType)}</span> },
            { header: 'Event ID', cell: (r) => <span className="font-mono text-xs">{String(r.eventId)}</span> },
            { header: 'Processed', cell: (r) => (r.processedAt ? formatDateTime(String(r.processedAt)) : '—') },
            { header: 'Error', cell: (r) => (r.processingError ? <span className="text-red-600">{String(r.processingError)}</span> : '—') },
            { header: 'Received', cell: (r) => formatDateTime(String(r.receivedAt)) },
            {
              header: '',
              cell: (r) => (
                <PermissionGate permission="webhooks.replay">
                  <ConfirmDialog
                    title="Replay webhook?"
                    description="Re-enqueues this event for processing. Handlers are idempotent."
                    confirmLabel="Replay"
                    onConfirm={() => replay.mutateAsync(String(r.id))}
                    trigger={(open) => <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); open(); }}>Replay</button>}
                  />
                </PermissionGate>
              ),
            },
          ]}
        />
      )}

      {selected && detail && (
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-heading text-lg font-bold text-brand-navy">Payload</h2>
            <button className="btn-secondary" onClick={() => setSelected(null)}>Close</button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg bg-sand-100 p-4 text-xs">{JSON.stringify(detail.payload ?? detail, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
