'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listFareRules, createFareRule, previewFare } from '@/lib/data';
import { DataTable } from '@/components/DataTable';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PermissionGate } from '@/components/PermissionGate';
import { formatINR, formatDateTime } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { FareRuleResponse, FareBreakdown } from '@aero/types';

const CATEGORIES = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'];

export default function FareRulesPage() {
  const qc = useQueryClient();
  const [category, setCategory] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['fareRules', category], queryFn: () => listFareRules(category || undefined) });

  const [form, setForm] = useState({
    category: 'SEDAN', baseFare: 100000, baseKm: 10, perKm: 1700, perMin: 250,
    nightSurcharge: 0.1, minFare: 100000, tokenPercent: 0.2, notes: '',
  });
  const [preview, setPreview] = useState<FareBreakdown | null>(null);

  const create = useMutation({
    mutationFn: () => createFareRule({ ...form, effectiveFrom: new Date().toISOString() }),
    onSuccess: () => { toast.success('Fare rule created'); qc.invalidateQueries({ queryKey: ['fareRules'] }); },
    onError: (err) => toast.error(err instanceof ApiError ? err.detail ?? 'Failed' : 'Failed'),
  });

  const runPreview = useMutation({
    mutationFn: () => previewFare({
      category: form.category,
      distanceKm: 25,
      durationMin: 40,
      scheduledAt: new Date().toISOString(),
      rule: {
        baseFare: form.baseFare, baseKm: form.baseKm, perKm: form.perKm, perMin: form.perMin,
        nightSurcharge: form.nightSurcharge, minFare: form.minFare, tokenPercent: form.tokenPercent,
      },
    }),
    onSuccess: (res) => setPreview(res),
    onError: (err) => toast.error(err instanceof ApiError ? err.detail ?? 'Failed' : 'Failed'),
  });

  const num = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Fare Rules</h1>

      <PermissionGate permission="fareRules.edit">
        <div className="card space-y-3">
          <h2 className="font-heading text-lg font-bold text-brand-navy">New rule (supersedes active)</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><label className="label">Category</label>
              <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </div>
            <div><label className="label">Base fare (paise)</label><input className="input" type="number" value={form.baseFare} onChange={num('baseFare')} /></div>
            <div><label className="label">Base km</label><input className="input" type="number" value={form.baseKm} onChange={num('baseKm')} /></div>
            <div><label className="label">Per km (paise)</label><input className="input" type="number" value={form.perKm} onChange={num('perKm')} /></div>
            <div><label className="label">Per min (paise)</label><input className="input" type="number" value={form.perMin} onChange={num('perMin')} /></div>
            <div><label className="label">Night surcharge</label><input className="input" type="number" step="0.05" value={form.nightSurcharge} onChange={num('nightSurcharge')} /></div>
            <div><label className="label">Min fare (paise)</label><input className="input" type="number" value={form.minFare} onChange={num('minFare')} /></div>
            <div><label className="label">Token %</label><input className="input" type="number" step="0.05" value={form.tokenPercent} onChange={num('tokenPercent')} /></div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-secondary" onClick={() => runPreview.mutate()}>Preview (25km / 40min)</button>
            <ConfirmDialog
              title="Create fare rule?"
              description="This supersedes the current active rule for the selected category. Existing bookings are unaffected."
              confirmLabel="Create rule"
              onConfirm={() => create.mutateAsync()}
              trigger={(open) => <button className="btn-primary" onClick={open}>Create rule</button>}
            />
            {preview && <span className="text-sm text-brand-navy">Total: <strong>{formatINR(preview.total)}</strong> · Token: {formatINR(preview.tokenAmount)}</span>}
          </div>
        </div>
      </PermissionGate>

      <div className="flex gap-3">
        <select className="input max-w-[200px]" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (<option key={c} value={c}>{c}</option>))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sand-500">Loading…</p>
      ) : (
        <DataTable<FareRuleResponse>
          rows={data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { header: 'Category', cell: (r) => r.category },
            { header: 'Base', cell: (r) => formatINR(r.baseFare) },
            { header: 'Per km', cell: (r) => formatINR(r.perKm) },
            { header: 'Per min', cell: (r) => formatINR(r.perMin) },
            { header: 'Min fare', cell: (r) => formatINR(r.minFare) },
            { header: 'Token %', cell: (r) => `${Math.round(r.tokenPercent * 100)}%` },
            { header: 'Effective from', cell: (r) => formatDateTime(r.effectiveFrom) },
            { header: 'Active', cell: (r) => (r.effectiveTo ? 'No' : 'Yes') },
          ]}
        />
      )}
    </div>
  );
}
