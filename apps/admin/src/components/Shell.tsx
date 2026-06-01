'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, CalendarCheck, Users, Car, IndianRupee,
  RefreshCcw, Webhook, ScrollText, UserCog, LogOut,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { logout } from '@/lib/auth';
import { can, type Permission } from '@/lib/rbac';
import { useMe } from '@/hooks/useMe';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  permission: Permission;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} />, permission: 'dashboard.view' },
  { href: '/bookings', label: 'Bookings', icon: <CalendarCheck size={18} />, permission: 'bookings.view' },
  { href: '/drivers', label: 'Drivers', icon: <Users size={18} />, permission: 'drivers.view' },
  { href: '/vehicles', label: 'Vehicles', icon: <Car size={18} />, permission: 'vehicles.view' },
  { href: '/fare-rules', label: 'Fare Rules', icon: <IndianRupee size={18} />, permission: 'fareRules.view' },
  { href: '/refunds', label: 'Refunds', icon: <RefreshCcw size={18} />, permission: 'refunds.view' },
  { href: '/webhooks', label: 'Webhooks', icon: <Webhook size={18} />, permission: 'webhooks.view' },
  { href: '/audit', label: 'Audit Log', icon: <ScrollText size={18} />, permission: 'audit.view' },
  { href: '/users', label: 'Users', icon: <UserCog size={18} />, permission: 'users.manage' },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();

  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      qc.clear();
      router.replace('/login');
    },
  });

  return (
    <div className="flex min-h-screen bg-sand-50">
      <aside className="sticky top-0 flex h-screen w-64 flex-col bg-gradient-to-b from-brand-navy-dark via-brand-navy to-brand-navy-dark text-white shadow-sidebar">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-orange font-heading text-lg font-extrabold text-white shadow-glow">
            A
          </div>
          <div>
            <p className="font-heading text-lg font-bold leading-tight">Aero Sarathi</p>
            <p className="text-[0.7rem] uppercase tracking-[0.18em] text-white/50">Admin Console</p>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {NAV.filter((item) => can(me?.role, item.permission)).map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`group relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-brand-orange text-white shadow-glow'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className={`transition-transform duration-200 ${active ? '' : 'group-hover:scale-110'}`}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 font-heading text-sm font-bold uppercase text-white">
              {(me?.name ?? '?').charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{me?.name ?? '—'}</p>
              <p className="text-[0.7rem] uppercase tracking-wide text-white/50">{me?.role}</p>
            </div>
          </div>
          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-sm text-white/70 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            onClick={() => signOut.mutate()}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl animate-fadeUp p-8">{children}</div>
      </main>
    </div>
  );
}
