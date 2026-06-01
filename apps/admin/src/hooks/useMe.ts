'use client';

import { useQuery } from '@tanstack/react-query';
import { me } from '@/lib/auth';
import type { AdminMe } from '@aero/types';

export function useMe() {
  return useQuery<AdminMe>({ queryKey: ['me'], queryFn: me, retry: false });
}
