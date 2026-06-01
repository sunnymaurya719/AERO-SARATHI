'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { useMe } from '@/hooks/useMe';

export default function DashLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { isError, isLoading } = useMe();

  useEffect(() => {
    if (isError) router.replace('/login');
  }, [isError, router]);

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-sand-500">Loading…</div>;
  }
  if (isError) return null;

  return <Shell>{children}</Shell>;
}
