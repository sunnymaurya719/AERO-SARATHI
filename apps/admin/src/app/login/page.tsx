'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { login, verify2fa } from '@/lib/auth';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<'credentials' | '2fa'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await login(email, password);
      setChallengeId(res.challengeId);
      setStage('2fa');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail ?? 'Login failed' : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await verify2fa(challengeId, code);
      toast.success('Signed in');
      router.replace('/dashboard');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail ?? 'Invalid code' : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-navy-dark via-brand-navy to-brand-navy-mid p-4">
      <div className="w-full max-w-sm animate-fadeUp rounded-3xl bg-white p-8 shadow-soft">
        <div className="mb-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-orange font-heading text-2xl font-extrabold text-white shadow-glow">
            A
          </div>
          <h1 className="font-heading text-2xl font-bold text-brand-navy">Aero Sarathi</h1>
          <p className="text-sm text-sand-500">Admin Console</p>
        </div>

        {stage === 'credentials' ? (
          <form onSubmit={submitCredentials} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required suppressHydrationWarning />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required suppressHydrationWarning />
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</button>
          </form>
        ) : (
          <form onSubmit={submit2fa} className="space-y-4">
            <p className="text-sm text-sand-500">Enter the 6-digit code from your authenticator app.</p>
            <div>
              <label className="label" htmlFor="code">Authentication code</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" className="input tracking-[0.5em] text-center text-lg" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} required />
            </div>
            <button className="btn-primary w-full" disabled={busy}>{busy ? 'Verifying…' : 'Verify'}</button>
            <button type="button" className="btn-secondary w-full" onClick={() => setStage('credentials')}>Back</button>
          </form>
        )}
      </div>
    </div>
  );
}
