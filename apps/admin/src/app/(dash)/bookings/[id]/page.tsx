'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  getBooking, transitionBooking, assignDriver, unassignDriver,
  cancelBooking, addBookingNote, listDrivers,
} from '@/lib/data';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PermissionGate } from '@/components/PermissionGate';
import { formatINR, formatDateTime } from '@/lib/format';
import { ApiError } from '@/lib/api';

const NEXT_STATES: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['DRIVER_ASSIGNED', 'CANCELLED'],
  DRIVER_ASSIGNED: ['EN_ROUTE', 'CANCELLED'],
  EN_ROUTE: ['ONGOING', 'NO_SHOW', 'CANCELLED'],
  ONGOING: ['COMPLETED'],
};

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['booking', id], queryFn: () => getBooking(id) });
  const { data: driversData } = useQuery({ queryKey: ['drivers', 'active'], queryFn: () => listDrivers({ status: 'ACTIVE', hasVehicle: 'true' }) });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['booking', id] });
  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.detail ?? 'Action failed' : 'Action failed');

  const transition = useMutation({
    mutationFn: ({ to, reason }: { to: string; reason: string }) => transitionBooking(id, to, reason),
    onSuccess: () => { toast.success('Status updated'); invalidate(); },
    onError: onErr,
  });
  const assign = useMutation({
    mutationFn: (driverId: string) => assignDriver(id, driverId),
    onSuccess: () => { toast.success('Driver assigned'); invalidate(); },
    onError: onErr,
  });
  const unassign = useMutation({
    mutationFn: () => unassignDriver(id),
    onSuccess: () => { toast.success('Driver unassigned'); invalidate(); },
    onError: onErr,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => cancelBooking(id, reason),
    onSuccess: () => { toast.success('Booking cancelled'); invalidate(); },
    onError: onErr,
  });
  const note$ = useMutation({
    mutationFn: (body: string) => addBookingNote(id, body),
    onSuccess: () => { toast.success('Note added'); setNote(''); invalidate(); },
    onError: onErr,
  });

  if (isLoading || !data) return <p className="text-sand-500">Loading…</p>;

  const b = data as Record<string, unknown>;
  const status = String(b.status);
  const history = (b.statusHistory as Record<string, unknown>[]) ?? [];
  const notes = (b.notes as Record<string, unknown>[]) ?? [];
  const driver = b.driver as Record<string, unknown> | null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{String(b.code)}</h1>
          <p className="text-sm text-sand-500">{formatDateTime(String(b.scheduledAt))}</p>
        </div>
        <StatusPill status={status} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2 space-y-3">
          <h2 className="font-heading text-lg font-bold text-brand-navy">Trip</h2>
          <Row label="Passenger" value={`${b.passengerName} · ${b.passengerPhone}`} />
          <Row label="Pickup" value={String(b.pickupAddress)} />
          <Row label="Drop" value={String(b.dropAddress)} />
          <Row label="Category" value={String(b.vehicleCategory)} />
          <Row label="Distance / Time" value={`${b.estimatedKm} km · ${b.estimatedMin} min`} />
          <Row label="Fare" value={formatINR(Number(b.fareTotal))} />
          <Row label="Token / Balance" value={`${formatINR(Number(b.tokenAmount))} / ${formatINR(Number(b.balanceAmount))}`} />
          <Row label="Driver" value={driver ? `${driver.name} · ${driver.phone}` : '—'} />
        </div>

        <div className="card space-y-3">
          <h2 className="font-heading text-lg font-bold text-brand-navy">Actions</h2>

          <PermissionGate permission="bookings.transition">
            {(NEXT_STATES[status] ?? []).filter((s) => s !== 'CANCELLED').map((to) => (
              <ConfirmDialog
                key={to}
                title={`Move to ${to}?`}
                confirmLabel={`Set ${to}`}
                requireReason
                onConfirm={(reason) => transition.mutateAsync({ to, reason })}
                trigger={(open) => <button className="btn-secondary w-full" onClick={open}>Set {to.replace(/_/g, ' ')}</button>}
              />
            ))}
          </PermissionGate>

          <PermissionGate permission="bookings.assignDriver">
            {driver ? (
              <button className="btn-secondary w-full" onClick={() => unassign.mutate()}>Unassign driver</button>
            ) : (
              <select
                className="input"
                defaultValue=""
                onChange={(e) => e.target.value && assign.mutate(e.target.value)}
              >
                <option value="" disabled>Assign driver…</option>
                {(driversData?.items ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name} ({d.homeCity})</option>
                ))}
              </select>
            )}
          </PermissionGate>

          <PermissionGate permission="bookings.cancel">
            {status !== 'CANCELLED' && status !== 'COMPLETED' && (
              <ConfirmDialog
                title="Cancel booking?"
                description="This applies the cancellation policy and may issue a refund."
                confirmLabel="Cancel booking"
                destructive
                requireReason
                onConfirm={(reason) => cancel.mutateAsync(reason)}
                trigger={(open) => <button className="btn-danger w-full" onClick={open}>Cancel booking</button>}
              />
            )}
          </PermissionGate>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 font-heading text-lg font-bold text-brand-navy">Status history</h2>
          <ul className="space-y-2 text-sm">
            {history.map((h, i) => (
              <li key={i} className="flex items-center justify-between border-b border-sand-100 pb-2 last:border-0">
                <span>{String(h.from ?? '—')} → <strong>{String(h.to)}</strong></span>
                <span className="text-sand-500">{formatDateTime(String(h.createdAt))}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h2 className="mb-3 font-heading text-lg font-bold text-brand-navy">Internal notes</h2>
          <PermissionGate permission="bookings.notes">
            <div className="mb-3 flex gap-2">
              <input className="input" placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn-primary" disabled={!note.trim()} onClick={() => note$.mutate(note.trim())}>Add</button>
            </div>
          </PermissionGate>
          <ul className="space-y-2 text-sm">
            {notes.map((n, i) => (
              <li key={i} className="border-b border-sand-100 pb-2 last:border-0">
                <p>{String(n.body)}</p>
                <p className="text-xs text-sand-500">{formatDateTime(String(n.createdAt))}</p>
              </li>
            ))}
            {notes.length === 0 && <li className="text-sand-500">No notes yet.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-sand-500">{label}</span>
      <span className="text-right font-medium text-brand-navy">{value}</span>
    </div>
  );
}
