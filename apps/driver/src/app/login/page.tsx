'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { saveTokens, type StoredTokens } from '@/lib/auth';

type Step = 'phone' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function requestOtp() {
    if (!/^\+91\d{10}$/.test(phone)) {
      toast.error('Enter a valid +91 phone number');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/otp/request', { method: 'POST', body: { phone }, auth: false });
      toast.success('OTP sent');
      setStep('code');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail ?? err.message : 'Failed to send OTP');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (!/^\d{6}$/.test(code)) {
      toast.error('Enter the 6-digit code');
      return;
    }
    setBusy(true);
    try {
      const tokens = await api<StoredTokens>('/auth/otp/verify', {
        method: 'POST',
        body: { phone, code },
        auth: false,
      });
      saveTokens(tokens);
      router.replace('/home');
    } catch (err) {
      const detail = err instanceof ApiError ? err.detail ?? err.message : 'Verification failed';
      toast.error(detail === 'not_a_driver' ? 'This number is not registered as a driver' : detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <div className="text-2xl font-bold tracking-wide text-brand-orange">AERO SARATHI</div>
        <p className="mt-1 text-sm text-sand-500">Driver Portal</p>
      </div>

      <div className="card space-y-4">
        {step === 'phone' ? (
          <>
            <div>
              <label className="label">Mobile number</label>
              <input
                className="input"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91XXXXXXXXXX"
              />
            </div>
            <button className="btn-primary w-full" disabled={busy} onClick={requestOtp}>
              {busy ? 'Sending…' : 'Send OTP'}
            </button>
          </>
        ) : (
          <>
            <div>
              <label className="label">Enter OTP sent to {phone}</label>
              <input
                className="input tracking-[0.5em]"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
              />
            </div>
            <button className="btn-primary w-full" disabled={busy} onClick={verifyOtp}>
              {busy ? 'Verifying…' : 'Verify & Sign in'}
            </button>
            <button
              className="w-full text-sm text-sand-500 underline"
              onClick={() => setStep('phone')}
            >
              Change number
            </button>
          </>
        )}
      </div>
    </main>
  );
}
