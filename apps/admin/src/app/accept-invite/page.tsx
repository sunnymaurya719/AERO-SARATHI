'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { acceptInvite } from '@/lib/auth';
import { ApiError } from '@/lib/api';

function AcceptInviteInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [otpauthUri, setOtpauthUri] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error('Passwords do not match');
    if (password.length < 12) return toast.error('Password must be at least 12 characters');
    setBusy(true);
    try {
      const res = await acceptInvite(token, password);
      setOtpauthUri(res.otpauthUri);
      toast.success('Account created. Set up 2FA, then sign in.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail ?? 'Invalid or expired invite' : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return <p className="text-center text-sm text-red-600">Missing invite token.</p>;
  }

  if (otpauthUri) {
    return (
      <div className="space-y-4 text-sm">
        <p className="font-semibold text-brand-navy">Set up two-factor authentication</p>
        <p className="text-sand-500">Add this secret to your authenticator app:</p>
        <code className="block break-all rounded-lg bg-sand-100 p-3 text-xs">{otpauthUri}</code>
        <button className="btn-primary w-full" onClick={() => router.replace('/login')}>Go to sign in</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-sand-500">Choose a password (minimum 12 characters).</p>
      <div>
        <label className="label" htmlFor="pw">Password</label>
        <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="cpw">Confirm password</label>
        <input id="cpw" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating…' : 'Accept invitation'}</button>
    </form>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-navy p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="font-heading text-2xl font-bold text-brand-navy">Aero Sarathi</h1>
          <p className="text-sm text-sand-500">Accept your invitation</p>
        </div>
        <Suspense fallback={<p className="text-center text-sm text-sand-500">Loading…</p>}>
          <AcceptInviteInner />
        </Suspense>
      </div>
    </div>
  );
}
