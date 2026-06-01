'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Car, FileText, MapPin, Star, Phone, Pencil } from 'lucide-react';
import {
  getDriver, updateDriver, assignDriverVehicle, unassignDriverVehicle,
  addDriverNote, listVehicles,
} from '@/lib/data';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PermissionGate } from '@/components/PermissionGate';
import { formatDateTime } from '@/lib/format';
import { ApiError } from '@/lib/api';

const DRIVER_STATUSES = ['ONBOARDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDING', 'DISABLED'] as const;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-sand-100 py-2.5 last:border-0">
      <span className="text-sm text-sand-500">{label}</span>
      <span className="text-sm font-medium text-brand-navy">{value}</span>
    </div>
  );
}

export default function DriverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', homeCity: '', status: '', rating: '' });
  const [noteText, setNoteText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['driver', id],
    queryFn: () => getDriver(id),
  });
  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles', 'active'],
    queryFn: () => listVehicles({ status: 'ACTIVE' }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['driver', id] });
  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.detail ?? 'Action failed' : 'Action failed');

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateDriver(id, body),
    onSuccess: () => { toast.success('Driver updated'); setEditing(false); invalidate(); qc.invalidateQueries({ queryKey: ['drivers'] }); },
    onError: onErr,
  });

  const assignVehicle = useMutation({
    mutationFn: (vehicleId: string) => assignDriverVehicle(id, vehicleId),
    onSuccess: () => { toast.success('Vehicle assigned'); invalidate(); },
    onError: onErr,
  });

  const unassignVehicle = useMutation({
    mutationFn: () => unassignDriverVehicle(id),
    onSuccess: () => { toast.success('Vehicle unassigned'); invalidate(); },
    onError: onErr,
  });

  const addNote = useMutation({
    mutationFn: (body: string) => addDriverNote(id, body),
    onSuccess: () => { toast.success('Note added'); setNoteText(''); invalidate(); },
    onError: onErr,
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) => updateDriver(id, { status }),
    onSuccess: () => { toast.success('Status updated'); invalidate(); qc.invalidateQueries({ queryKey: ['drivers'] }); },
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

  const d = data as Record<string, unknown>;
  const vehicle = d.vehicle as Record<string, unknown> | null;
  const documents = (d.documents as Record<string, unknown>[]) ?? [];
  const notes = (d.notes as Record<string, unknown>[]) ?? [];
  const status = String(d.status);
  const availableVehicles = (vehiclesData?.items ?? []).filter((v) => v.id !== (vehicle?.id as string | undefined));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="flex items-center gap-1.5 text-sm text-sand-500 hover:text-brand-navy transition-colors">
          <ArrowLeft size={16} /> Back
        </button>
      </div>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-navy font-heading text-2xl font-bold text-white">
            {String(d.name ?? '?').charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="page-title">{String(d.name)}</h1>
            <div className="mt-1 flex items-center gap-3">
              <span className="flex items-center gap-1 text-sm text-sand-500"><Phone size={13} /> {String(d.phone)}</span>
              {d.rating != null && (
                <span className="flex items-center gap-1 text-sm text-brand-navy font-medium"><Star size={13} className="text-brand-orange" /> {Number(d.rating).toFixed(1)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusPill status={status} />
          <PermissionGate permission="drivers.edit">
            <button
              className="btn-secondary"
              onClick={() => {
                setEditForm({ name: String(d.name), homeCity: String(d.homeCity), status, rating: d.rating != null ? String(d.rating) : '' });
                setEditing(true);
              }}
            >
              <Pencil size={14} /> Edit
            </button>
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Info */}
        <div className="card lg:col-span-2 space-y-0">
          <h2 className="mb-3 font-heading text-base font-bold text-brand-navy flex items-center gap-2"><MapPin size={15} /> Details</h2>
          <InfoRow label="License No." value={String(d.licenseNo)} />
          <InfoRow label="Home city" value={String(d.homeCity)} />
          <InfoRow label="Status" value={status} />
          <InfoRow label="Rating" value={d.rating != null ? `${Number(d.rating).toFixed(1)} / 5` : '—'} />
          <InfoRow label="Joined" value={formatDateTime(String(d.createdAt))} />
        </div>

        {/* Vehicle */}
        <div className="card space-y-3">
          <h2 className="font-heading text-base font-bold text-brand-navy flex items-center gap-2"><Car size={15} /> Vehicle</h2>
          {vehicle ? (
            <div className="rounded-xl border border-sand-100 bg-sand-50 p-4">
              <p className="font-mono font-semibold text-brand-navy">{String(vehicle.regNo)}</p>
              <p className="text-sm text-sand-500">{String(vehicle.category)} · {String(vehicle.model ?? '—')}</p>
              <div className="mt-2 flex items-center justify-between">
                <StatusPill status={String(vehicle.status ?? 'ACTIVE')} />
                <PermissionGate permission="drivers.edit">
                  <button className="btn-danger text-xs" onClick={() => unassignVehicle.mutate()}>Unassign</button>
                </PermissionGate>
              </div>
            </div>
          ) : (
            <p className="text-sm text-sand-500">No vehicle assigned</p>
          )}
          <PermissionGate permission="drivers.edit">
            {availableVehicles.length > 0 && (
              <select
                className="input"
                defaultValue=""
                onChange={(e) => e.target.value && assignVehicle.mutate(e.target.value)}
              >
                <option value="" disabled>{vehicle ? 'Reassign vehicle…' : 'Assign vehicle…'}</option>
                {availableVehicles.map((v) => (
                  <option key={v.id} value={v.id}>{v.regNo} — {v.category}</option>
                ))}
              </select>
            )}
          </PermissionGate>

          <PermissionGate permission="drivers.edit">
            <div className="border-t border-sand-100 pt-3">
              <label className="label">Change status</label>
              <select
                className="input"
                value={status}
                onChange={(e) => updateStatus.mutate(e.target.value)}
              >
                {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </PermissionGate>
        </div>
      </div>

      {/* Documents */}
      <div className="card">
        <h2 className="mb-4 font-heading text-base font-bold text-brand-navy flex items-center gap-2"><FileText size={15} /> Documents</h2>
        {documents.length === 0 ? (
          <p className="text-sm text-sand-500">No documents uploaded.</p>
        ) : (
          <div className="divide-y divide-sand-100">
            {documents.map((doc, i) => (
              <div key={i} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-semibold text-brand-navy">{String(doc.type)}</p>
                  <p className="text-xs text-sand-500">
                    Uploaded {formatDateTime(String(doc.createdAt))}
                    {doc.expiresAt ? ` · Expires ${formatDateTime(String(doc.expiresAt))}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {doc.verified ? (
                    <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700 ring-1 ring-inset ring-green-200">Verified</span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">Pending</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="card">
        <h2 className="mb-4 font-heading text-base font-bold text-brand-navy">Internal notes</h2>
        <PermissionGate permission="drivers.edit">
          <div className="mb-4 flex gap-2">
            <input
              className="input flex-1"
              placeholder="Add a note…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && noteText.trim() && addNote.mutate(noteText.trim())}
            />
            <button className="btn-primary" disabled={!noteText.trim() || addNote.isPending} onClick={() => addNote.mutate(noteText.trim())}>
              {addNote.isPending ? '…' : 'Add'}
            </button>
          </div>
        </PermissionGate>
        {notes.length === 0 ? (
          <p className="text-sm text-sand-500">No notes.</p>
        ) : (
          <ul className="divide-y divide-sand-100 text-sm">
            {notes.map((n, i) => (
              <li key={i} className="py-3">
                <p className="text-brand-navy">{String(n.body ?? n.content ?? '')}</p>
                <p className="mt-1 text-xs text-sand-500">{formatDateTime(String(n.createdAt))}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditing(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-soft" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-heading text-lg font-bold text-brand-navy">Edit driver</h3>
            <div className="space-y-3">
              <div><label className="label">Name</label><input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div><label className="label">Home city</label><input className="input" value={editForm.homeCity} onChange={(e) => setEditForm({ ...editForm, homeCity: e.target.value })} /></div>
              <div><label className="label">Rating (0–5)</label><input className="input" type="number" step="0.1" min="0" max="5" value={editForm.rating} onChange={(e) => setEditForm({ ...editForm, rating: e.target.value })} /></div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => update.mutate({
                name: editForm.name || undefined,
                homeCity: editForm.homeCity || undefined,
                rating: editForm.rating ? Number(editForm.rating) : undefined,
              })}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
