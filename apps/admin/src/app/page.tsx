'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { me } from '@/lib/auth';

export default function HomePage() {
  const router = useRouter();
  const { isError, isSuccess } = useQuery({ queryKey: ['me'], queryFn: me, retry: false });

  useEffect(() => {
    if (isSuccess) router.replace('/dashboard');
    if (isError) router.replace('/login');
  }, [isSuccess, isError, router]);

  return (
    <div className="flex h-screen items-center justify-center text-sand-500">
      Loading…
    </div>
  );
}
