'use client';

import { useState, type ReactNode } from 'react';

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  requireReason = false,
  onConfirm,
}: {
  trigger: (open: () => void) => ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  onConfirm: (reason: string) => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (requireReason && reason.trim().length < 3) return;
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setReason('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {trigger(() => setOpen(true))}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-2 font-heading text-lg font-bold text-brand-navy">{title}</h3>
            {description && <p className="mb-4 text-sm text-sand-500">{description}</p>}
            {requireReason && (
              <div className="mb-4">
                <label className="label" htmlFor="reason">Reason</label>
                <textarea id="reason" className="input min-h-[80px]" value={reason} onChange={(e) => setReason(e.target.value)} required />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className={destructive ? 'btn-danger' : 'btn-primary'} onClick={confirm} disabled={busy || (requireReason && reason.trim().length < 3)}>
                {busy ? 'Working…' : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
