'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthed } from '@/lib/auth';

export default function IndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(isAuthed() ? '/home' : '/login');
  }, [router]);
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sand-500">Loading…</p>
    </main>
  );
}
