'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { listDrivers, createDriver, type DriverFilters } from '@/lib/data';
import { DataTable } from '@/components/DataTable';
import { StatusPill } from '@/components/StatusPill';
import { PermissionGate } from '@/components/PermissionGate';
import { ApiError } from '@/lib/api';
import type { AdminDriverRow } from '@aero/types';

const STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'DISABLED'];

export default function DriversPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<DriverFilters>({});
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ phone: '', name: '', licenseNo: '', homeCity: '' });
  const { data, isLoading } = useQuery({ queryKey: ['drivers', filters], queryFn: () => listDrivers(filters) });

  const create = useMutation({
    mutationFn: () => createDriver(form),
    onSuccess: () => {
      toast.success('Driver created');
      setForm({ phone: '', name: '', licenseNo: '', homeCity: '' });
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ['drivers'] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail ?? 'Failed' : 'Failed'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Drivers</h1>
        <PermissionGate permission="drivers.edit">
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Add driver</button>
        </PermissionGate>
      </div>

      <div className="flex flex-wrap gap-3">
        <input className="input max-w-xs" placeholder="Search name / phone…" value={filters.q ?? ''} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined, cursor: undefined }))} />
        <select className="input max-w-[200px]" value={filters.status ?? ''} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined, cursor: undefined }))}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
        <select className="input max-w-[160px]" value={filters.hasVehicle ?? ''} onChange={(e) => setFilters((f) => ({ ...f, hasVehicle: e.target.value || undefined, cursor: undefined }))}>
          <option value="">Any vehicle</option>
          <option value="true">Has vehicle</option>
          <option value="false">No vehicle</option>
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-sand-100" />)}</div>
      ) : (
        <DataTable<AdminDriverRow>
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/drivers/${r.id}`)}
          columns={[
            { header: 'Name', cell: (r) => <span className="font-medium text-brand-navy">{r.name}</span> },
            { header: 'Phone', cell: (r) => <span className="font-mono text-sm">{r.phone}</span> },
            { header: 'License', cell: (r) => <span className="font-mono text-xs text-sand-500">{r.licenseNo}</span> },
            { header: 'City', cell: (r) => r.homeCity },
            { header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
            { header: 'Rating', cell: (r) => r.rating != null ? <span className="font-semibold">{r.rating.toFixed(1)} ★</span> : <span className="text-sand-400">—</span> },
            { header: 'Vehicle', cell: (r) => r.vehicleId ? <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 ring-1 ring-inset ring-green-200">Assigned</span> : <span className="text-sand-400">—</span> },
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
            <h3 className="mb-4 font-heading text-lg font-bold text-brand-navy">Add driver</h3>
            <div className="space-y-3">
              <div><label className="label">Full name</label><input className="input" placeholder="Rahul Singh" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><label className="label">Phone</label><input className="input" placeholder="+919876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label className="label">License No.</label><input className="input" placeholder="PB0120230001234" value={form.licenseNo} onChange={(e) => setForm({ ...form, licenseNo: e.target.value })} /></div>
              <div><label className="label">Home city</label><input className="input" placeholder="Chandigarh" value={form.homeCity} onChange={(e) => setForm({ ...form, homeCity: e.target.value })} /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={create.isPending || !form.name || !form.phone || !form.licenseNo || !form.homeCity}
                onClick={() => create.mutate()}
              >
                {create.isPending ? 'Creating…' : 'Create driver'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
