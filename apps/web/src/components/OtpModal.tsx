'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { useBookingStore } from '@/store/booking';

export function OtpModal({ onClose, onVerified }: { onClose: () => void; onVerified: () => void }) {
  const setAuth = useBookingStore((s) => s.setAuth);
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'phone' | 'code'>('phone');
  const [error, setError] = useState<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: () => api.requestOtp(phone),
    onSuccess: () => {
      setError(null);
      setStage('code');
    },
    onError: (err) => setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : 'Failed to send OTP'),
  });

  const verifyMutation = useMutation({
    mutationFn: () => api.verifyOtp(phone, code),
    onSuccess: (res) => {
      setAuth(res.accessToken, res.user);
      onVerified();
    },
    onError: (err) => setError(err instanceof ApiError ? err.problem.detail ?? err.problem.title : 'Invalid code'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-xl font-bold text-brand-navy">Verify your phone</h3>

        {stage === 'phone' ? (
          <div className="space-y-4">
            <input
              className="input"
              placeholder="+91XXXXXXXXXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button className="btn-primary w-full" disabled={requestMutation.isPending} onClick={() => requestMutation.mutate()}>
              {requestMutation.isPending ? 'Sending…' : 'Send OTP'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">Enter the 6-digit code sent to {phone}.</p>
            <input
              className="input tracking-[0.5em]"
              placeholder="------"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              className="btn-primary w-full"
              disabled={verifyMutation.isPending || code.length !== 6}
              onClick={() => verifyMutation.mutate()}
            >
              {verifyMutation.isPending ? 'Verifying…' : 'Verify & continue'}
            </button>
            <button className="text-sm text-slate-500 underline" onClick={() => setStage('phone')}>
              Change number
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
