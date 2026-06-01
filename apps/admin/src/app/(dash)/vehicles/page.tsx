'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { listVehicles, createVehicle, type VehicleFilters } from '@/lib/data';
import { DataTable } from '@/components/DataTable';
import { StatusPill } from '@/components/StatusPill';
import { PermissionGate } from '@/components/PermissionGate';
import { ApiError } from '@/lib/api';
import type { AdminVehicleRow } from '@aero/types';

const CATEGORIES = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'];
const STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED'];

export default function VehiclesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<VehicleFilters>({});
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ regNo: '', category: 'SEDAN', model: '', capacity: 4, ownership: 'DRIVER' });
  const { data, isLoading } = useQuery({ queryKey: ['vehicles', filters], queryFn: () => listVehicles(filters) });

  const create = useMutation({
    mutationFn: () => createVehicle({ ...form, capacity: Number(form.capacity) }),
    onSuccess: () => {
      toast.success('Vehicle created');
      setForm({ regNo: '', category: 'SEDAN', model: '', capacity: 4, ownership: 'DRIVER' });
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail ?? 'Failed' : 'Failed'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Vehicles</h1>
        <PermissionGate permission="vehicles.edit">
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Add vehicle</button>
        </PermissionGate>
      </div>

      <div className="flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search reg no / model…" value={filters.q ?? ''} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined, cursor: undefined }))} />
        <select className="input max-w-[180px]" value={filters.category ?? ''} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value || undefined, cursor: undefined }))}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
        <select className="input max-w-[160px]" value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined, cursor: undefined }))}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-sand-100" />)}</div>
      ) : (
        <DataTable<AdminVehicleRow>
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/vehicles/${r.id}`)}
          columns={[
            { header: 'Reg No.', cell: (r) => <span className="font-mono font-semibold text-brand-navy">{r.regNo}</span> },
            { header: 'Category', cell: (r) => r.category },
            { header: 'Model', cell: (r) => r.model },
            { header: 'Capacity', cell: (r) => `${r.capacity} seats` },
            { header: 'Ownership', cell: (r) => r.ownership === 'COMPANY' ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">Company</span> : <span className="text-sand-500">Driver</span> },
            { header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
          ]}
        />
      )}

      {data?.nextCursor && (
        <button className="btn-secondary" onClick={() => setFilters((f) => ({ ...f, cursor: data.nextCursor ?? undefined }))}>
          Load more
        </button>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-heading text-lg font-bold text-brand-navy">Add vehicle</h3>
            <div className="space-y-3">
              <div><label className="label">Reg No.</label><input className="input" placeholder="PB01AB1234" value={form.regNo} onChange={(e) => setForm({ ...form, regNo: e.target.value })} /></div>
              <div>
                <label className="label">Category</label>
                <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                </select>
              </div>
              <div><label className="label">Model</label><input className="input" placeholder="Swift Dzire" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
              <div><label className="label">Capacity (seats)</label><input className="input" type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })} /></div>
              <div>
                <label className="label">Ownership</label>
                <select className="input" value={form.ownership} onChange={(e) => setForm({ ...form, ownership: e.target.value })}>
                  <option value="DRIVER">Driver-owned</option>
                  <option value="COMPANY">Company-owned</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={create.isPending || !form.regNo || !form.model}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Creating…' : 'Create vehicle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
