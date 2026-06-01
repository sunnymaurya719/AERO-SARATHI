'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { listBookings, type BookingFilters } from '@/lib/data';
import { DataTable } from '@/components/DataTable';
import { StatusPill } from '@/components/StatusPill';
import { formatINR, formatDateTime } from '@/lib/format';
import type { AdminBookingRow } from '@aero/types';

const STATUSES = ['PENDING', 'CONFIRMED', 'DRIVER_ASSIGNED', 'EN_ROUTE', 'ONGOING', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];

export default function BookingsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<BookingFilters>({});
  const { data, isLoading } = useQuery({ queryKey: ['bookings', filters], queryFn: () => listBookings(filters) });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Bookings</h1>

      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search code / phone…"
          value={filters.q ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value || undefined, cursor: undefined }))}
        />
        <select
          className="input max-w-[200px]"
          value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value || undefined, cursor: undefined }))}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sand-500">Loading…</p>
      ) : (
        <DataTable<AdminBookingRow>
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/bookings/${r.id}`)}
          columns={[
            { header: 'Code', cell: (r) => <span className="font-mono font-medium">{r.code}</span> },
            { header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
            { header: 'Passenger', cell: (r) => <div><div>{r.passengerName}</div><div className="text-xs text-sand-500">{r.passengerPhone}</div></div> },
            { header: 'Category', cell: (r) => r.vehicleCategory },
            { header: 'Scheduled', cell: (r) => formatDateTime(r.scheduledAt) },
            { header: 'Fare', cell: (r) => formatINR(r.fareTotal), className: 'text-right' },
            { header: 'Driver', cell: (r) => (r.driverId ? 'Assigned' : '—') },
          ]}
        />
      )}

      {data?.nextCursor && (
        <button className="btn-secondary" onClick={() => setFilters((f) => ({ ...f, cursor: data.nextCursor ?? undefined }))}>
          Load more
        </button>
      )}
    </div>
  );
}
