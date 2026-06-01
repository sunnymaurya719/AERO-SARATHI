'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Home, ListChecks, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { isAuthed, clearTokens } from '@/lib/auth';
import { connectSocket, disconnectSocket } from '@/lib/socket';

const HEARTBEAT_MS = 30_000;

export default function AppLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/login');
      return;
    }
    connectSocket();

    // Periodic heartbeat with best-effort geolocation.
    const beat = () => {
      const send = (body: Record<string, number> = {}) =>
        api('/me/heartbeat', { method: 'POST', body }).catch(() => undefined);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => void send({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => void send(),
          { maximumAge: 60_000, timeout: 5_000 },
        );
      } else {
        void send();
      }
    };
    beat();
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      disconnectSocket();
    };
  }, [router]);

  function logout() {
    clearTokens();
    disconnectSocket();
    router.replace('/login');
  }

  const navItems = [
    { href: '/home', label: 'Home', icon: Home },
    { href: '/trips', label: 'Trips', icon: ListChecks },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col">
      <header className="flex items-center justify-between border-b border-sand-200 bg-white px-5 py-4">
        <span className="text-lg font-bold tracking-wide text-brand-orange">AERO SARATHI</span>
        <button onClick={logout} className="text-sand-500 hover:text-brand-navy" aria-label="Logout">
          <LogOut size={20} />
        </button>
      </header>

      <main className="flex-1 px-5 py-5">{children}</main>

      <nav className="sticky bottom-0 flex border-t border-sand-200 bg-white">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-xs font-medium ${
                active ? 'text-brand-orange' : 'text-sand-500'
              }`}
            >
              <Icon size={20} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
