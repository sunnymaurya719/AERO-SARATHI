'use client';

import type { ReactNode } from 'react';

interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty = 'No records found',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-sand-100 bg-white shadow-soft">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-sand-100 bg-sand-50/80 text-[0.7rem] uppercase tracking-[0.1em] text-sand-500">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={`px-5 py-3.5 font-semibold ${c.className ?? ''}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-5 py-14 text-center text-sand-500">{empty}</td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-b border-sand-100 transition-colors last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-brand-orange-light/40' : 'hover:bg-sand-50/60'}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.header} className={`px-5 py-3.5 ${c.className ?? ''}`}>{c.cell(row)}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
