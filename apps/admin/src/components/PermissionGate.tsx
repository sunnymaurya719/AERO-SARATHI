'use client';

import { can, type Permission } from '@/lib/rbac';
import { useMe } from '@/hooks/useMe';
import type { ReactNode } from 'react';

export function PermissionGate({ permission, children, fallback = null }: { permission: Permission; children: ReactNode; fallback?: ReactNode }) {
  const { data } = useMe();
  if (!can(data?.role, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
