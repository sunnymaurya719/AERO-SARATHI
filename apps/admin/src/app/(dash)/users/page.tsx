'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { listUsers, inviteUser, disableUser, enableUser, changeUserRole, resetUser2fa } from '@/lib/data';
import { DataTable } from '@/components/DataTable';
import { StatusPill } from '@/components/StatusPill';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDateTime } from '@/lib/format';
import { ApiError } from '@/lib/api';
import type { AdminUserRow } from '@aero/types';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'];

export default function UsersPage() {
  const qc = useQueryClient();
  const [invite, setInvite] = useState({ email: '', role: 'SUPPORT' });
  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const onErr = (err: unknown) => toast.error(err instanceof ApiError ? err.detail ?? 'Failed' : 'Failed');

  const invite$ = useMutation({
    mutationFn: () => inviteUser(invite.email, invite.role),
    onSuccess: () => { toast.success('Invitation sent'); setInvite({ email: '', role: 'SUPPORT' }); refresh(); },
    onError: onErr,
  });
  const disable$ = useMutation({ mutationFn: disableUser, onSuccess: () => { toast.success('User disabled'); refresh(); }, onError: onErr });
  const enable$ = useMutation({ mutationFn: enableUser, onSuccess: () => { toast.success('User enabled'); refresh(); }, onError: onErr });
  const role$ = useMutation({ mutationFn: ({ id, role }: { id: string; role: string }) => changeUserRole(id, role), onSuccess: () => { toast.success('Role updated'); refresh(); }, onError: onErr });
  const reset$ = useMutation({ mutationFn: resetUser2fa, onSuccess: () => { toast.success('2FA reset'); refresh(); }, onError: onErr });

  return (
    <div className="space-y-6">
      <h1 className="page-title">Admin Users</h1>

      <div className="card flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[220px]"><label className="label">Email</label><input className="input" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></div>
        <div><label className="label">Role</label>
          <select className="input" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
            {ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
          </select>
        </div>
        <button className="btn-primary" disabled={!invite.email} onClick={() => invite$.mutate()}>Send invite</button>
      </div>

      {isLoading ? (
        <p className="text-sand-500">Loading…</p>
      ) : (
        <DataTable<AdminUserRow>
          rows={data ?? []}
          rowKey={(r) => r.id}
          columns={[
            { header: 'Name', cell: (r) => <span className="font-medium">{r.name}</span> },
            { header: 'Email', cell: (r) => r.email },
            {
              header: 'Role',
              cell: (r) => (
                <select className="input max-w-[150px]" value={r.role} onChange={(e) => role$.mutate({ id: r.id, role: e.target.value })}>
                  {ROLES.map((role) => (<option key={role} value={role}>{role}</option>))}
                </select>
              ),
            },
            { header: 'Status', cell: (r) => <StatusPill status={r.status} /> },
            { header: '2FA', cell: (r) => (r.totpEnabled ? 'On' : 'Off') },
            { header: 'Last login', cell: (r) => formatDateTime(r.lastLoginAt) },
            {
              header: '',
              cell: (r) => (
                <div className="flex gap-2">
                  {r.status === 'ACTIVE' ? (
                    <ConfirmDialog title="Disable user?" confirmLabel="Disable" destructive onConfirm={() => disable$.mutateAsync(r.id)}
                      trigger={(open) => <button className="btn-secondary" onClick={open}>Disable</button>} />
                  ) : (
                    <button className="btn-secondary" onClick={() => enable$.mutate(r.id)}>Enable</button>
                  )}
                  <ConfirmDialog title="Reset 2FA?" description="Forces the user to re-enrol an authenticator on next login." confirmLabel="Reset 2FA" onConfirm={() => reset$.mutateAsync(r.id)}
                    trigger={(open) => <button className="btn-secondary" onClick={open}>Reset 2FA</button>} />
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
