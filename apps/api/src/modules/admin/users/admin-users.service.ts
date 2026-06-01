import { randomBytes, createHash } from 'node:crypto';
import type { AdminRole } from '@aero/db';
import { prisma } from '../../../prisma.js';
import { env } from '../../../env.js';
import { Errors } from '../../../errors.js';
import { sendEmail } from '../../notifications/channels/email.sendgrid.js';
import { generateTotpSecret } from '../auth/totp.js';

export async function listAdminUsers() {
  return prisma.adminUser.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, email: true, name: true, role: true, status: true,
      totpEnabled: true, lastLoginAt: true, lockedUntil: true, createdAt: true,
    },
  });
}

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'] as const;

export interface InviteInput {
  email: string;
  role: AdminRole;
  invitedById: string;
}

/** Creates (or replaces) an invite and emails a magic accept link. */
export async function inviteAdmin(input: InviteInput) {
  const existingUser = await prisma.adminUser.findUnique({ where: { email: input.email } });
  if (existingUser) throw Errors.conflict('An admin with this email already exists');
  if (!(ROLES as readonly string[]).includes(input.role)) throw Errors.validation('Invalid role');

  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + env.ADMIN_INVITE_TTL_HOURS * 60 * 60 * 1000);

  await prisma.adminInvite.upsert({
    where: { email: input.email },
    create: { email: input.email, role: input.role, tokenHash, invitedById: input.invitedById, expiresAt },
    update: { role: input.role, tokenHash, invitedById: input.invitedById, expiresAt, acceptedAt: null },
  });

  const acceptUrl = `${env.ADMIN_PUBLIC_URL}/accept-invite?token=${token}`;
  await sendEmail(input.email, {
    channel: 'EMAIL',
    subject: 'You have been invited to Aero Sarathi Admin',
    html: `<p>You have been invited as <strong>${input.role}</strong>.</p>
<p><a href="${acceptUrl}">Accept your invitation</a> (expires in ${env.ADMIN_INVITE_TTL_HOURS} hours).</p>
<p>If the link does not work, paste this URL into your browser:<br>${acceptUrl}</p>`,
  });

  return { email: input.email, role: input.role, expiresAt };
}

export async function disableAdmin(id: string, actingUserId: string) {
  if (id === actingUserId) throw Errors.conflict('You cannot disable your own account');
  const user = await prisma.adminUser.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw Errors.notFound('Admin not found');
  const updated = await prisma.adminUser.update({ where: { id }, data: { status: 'DISABLED' } });
  // Revoke all active sessions for the disabled user.
  await prisma.adminSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  return { id: updated.id, status: updated.status };
}

export async function enableAdmin(id: string) {
  const user = await prisma.adminUser.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw Errors.notFound('Admin not found');
  const updated = await prisma.adminUser.update({ where: { id }, data: { status: 'ACTIVE', failedAttempts: 0, lockedUntil: null } });
  return { id: updated.id, status: updated.status };
}

export async function changeRole(id: string, role: AdminRole, actingUserId: string) {
  if (id === actingUserId) throw Errors.conflict('You cannot change your own role');
  if (!(ROLES as readonly string[]).includes(role)) throw Errors.validation('Invalid role');
  const user = await prisma.adminUser.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw Errors.notFound('Admin not found');
  const updated = await prisma.adminUser.update({ where: { id }, data: { role } });
  return { id: updated.id, role: updated.role };
}

/** Resets 2FA: clears the secret, forces re-enrolment on next login. */
export async function reset2fa(id: string) {
  const user = await prisma.adminUser.findUnique({ where: { id }, select: { id: true } });
  if (!user) throw Errors.notFound('Admin not found');
  const secret = generateTotpSecret();
  await prisma.adminUser.update({ where: { id }, data: { totpSecret: secret, totpEnabled: false } });
  // Revoke active sessions so the user must re-authenticate + re-enrol.
  await prisma.adminSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  return { id, totpEnabled: false };
}
