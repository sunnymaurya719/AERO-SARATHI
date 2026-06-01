'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Car, Pencil } from 'lucide-react';
import { getVehicle, updateVehicle } from '@/lib/data';
import { StatusPill } from '@/components/StatusPill';
import { PermissionGate } from '@/components/PermissionGate';
import { formatDateTime } from '@/lib/format';
import { ApiError } from '@/lib/api';

const VEHICLE_STATUSES = ['ACTIVE', 'MAINTENANCE', 'RETIRED'] as const;
const CATEGORIES = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'] as const;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-sand-100 py-2.5 last:border-0">
      <span className="text-sm text-sand-500">{label}</span>
      <span className="text-sm font-medium text-brand-navy">{value}</span>
    </div>
  );
}

export default function VehicleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ model: '', capacity: '', status: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['vehicle', id],
    queryFn: () => getVehicle(id),
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['vehicle', id] }); qc.invalidateQueries({ queryKey: ['vehicles'] }); };
  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.detail ?? 'Action failed' : 'Action failed');

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateVehicle(id, body),
    onSuccess: () => { toast.success('Vehicle updated'); setEditing(false); invalidate(); },
    onError: onErr,
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) => updateVehicle(id, { status }),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: onErr,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-sand-100" />
        <div className="card h-64 animate-pulse" />
      </div>
    );
  }

  const v = data as Record<string, unknown>;
  const drivers = (v.drivers as Record<string, unknown>[]) ?? [];
  const emiPlan = v.emiPlan as Record<string, unknown> | null;
  const status = String(v.status);

  return (
    <div className="space-y-6">
      {/* Back */}
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-sand-500 hover:text-brand-navy transition-colors">
        <ArrowLeft size={16} /> Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-navy-mid">
            <Car size={28} className="text-white" />
          </div>
          <div>
            <h1 className="page-title font-mono">{String(v.regNo)}</h1>
            <p className="text-sm text-sand-500">{String(v.category)} · {String(v.model)} · {String(v.capacity)} seats</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={status} />
          <PermissionGate permission="vehicles.edit">
            <button
              className="btn-secondary"
              onClick={() => {
                setEditForm({ model: String(v.model), capacity: String(v.capacity), status });
                setEditing(true);
              }}
            >
              <Pencil size={14} /> Edit
            </button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Vehicle Info */}
        <div className="card lg:col-span-2 space-y-0">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-navy">Vehicle details</h2>
          <InfoRow label="Registration No." value={String(v.regNo)} />
          <InfoRow label="Category" value={String(v.category)} />
          <InfoRow label="Model" value={String(v.model)} />
          <InfoRow label="Capacity" value={`${v.capacity} seats`} />
          <InfoRow label="Ownership" value={String(v.ownership)} />
          <InfoRow label="Status" value={status} />
          <InfoRow label="Added" value={formatDateTime(String(v.createdAt))} />
        </div>

        {/* Status control + Drivers */}
        <div className="space-y-6">
          <PermissionGate permission="vehicles.edit">
            <div className="card">
              <label className="label">Change status</label>
              <select
                className="input"
                value={status}
                onChange={(e) => updateStatus.mutate(e.target.value)}
              >
                {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </PermissionGate>

          <div className="card">
            <h2 className="mb-3 font-heading text-base font-bold text-brand-navy">Assigned drivers</h2>
            {drivers.length === 0 ? (
              <p className="text-sm text-sand-500">No drivers assigned.</p>
            ) : (
              <ul className="divide-y divide-sand-100">
                {drivers.map((d, i) => (
                  <li key={i} className="py-2.5">
                    <p className="text-sm font-medium text-brand-navy">{String(d.name)}</p>
                    <p className="text-xs text-sand-500">{String(d.phone)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* EMI Plan */}
      {emiPlan && (
        <div className="card">
          <h2 className="mb-4 font-heading text-base font-bold text-brand-navy">EMI Plan</h2>
          <div className="grid grid-cols-2 gap-x-8 md:grid-cols-4">
            <InfoRow label="Lender" value={String(emiPlan.lender)} />
            <InfoRow label="Loan ref" value={String(emiPlan.loanRef)} />
            <InfoRow label="Principal" value={`₹${(Number(emiPlan.principalAmount) / 100).toFixed(2)}`} />
            <InfoRow label="Monthly EMI" value={`₹${(Number(emiPlan.monthlyEmi) / 100).toFixed(2)}`} />
            <InfoRow label="Tenure" value={`${emiPlan.tenureMonths} months`} />
            <InfoRow label="Start date" value={formatDateTime(String(emiPlan.startDate))} />
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-heading text-lg font-bold text-brand-navy">Edit vehicle</h3>
            <div className="space-y-3">
              <div><label className="label">Model</label><input className="input" value={editForm.model} onChange={(e) => setEditForm({ ...editForm, model: e.target.value })} /></div>
              <div><label className="label">Capacity</label><input className="input" type="number" value={editForm.capacity} onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })} /></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button
                className="btn-primary"
                disabled={update.isPending}
                onClick={() => update.mutate({ model: editForm.model || undefined, capacity: editForm.capacity ? Number(editForm.capacity) : undefined })}
              >
                {update.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
