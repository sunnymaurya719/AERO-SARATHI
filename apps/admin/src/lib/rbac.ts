import type { AdminRole } from '@aero/types';

/**
 * Mirror of the API's permission matrix (apps/api/src/rbac/matrix.ts). The API
 * is the only security boundary — this is used purely to hide menu items and
 * disable controls the user cannot use.
 */
export const PERMISSIONS = {
  'dashboard.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  'bookings.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  'bookings.transition': ['SUPER_ADMIN', 'ADMIN', 'OPS'],
  'bookings.assignDriver': ['SUPER_ADMIN', 'ADMIN', 'OPS'],
  'bookings.cancel': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE'],
  'bookings.refundOverride': ['SUPER_ADMIN', 'ADMIN'],
  'bookings.notes': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  'bookings.resendNotification': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'SUPPORT'],
  'bookings.export': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE'],
  'drivers.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  'drivers.edit': ['SUPER_ADMIN', 'ADMIN', 'OPS'],
  'drivers.delete': ['SUPER_ADMIN', 'ADMIN'],
  'drivers.docs': ['SUPER_ADMIN', 'ADMIN', 'OPS'],
  'vehicles.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  'vehicles.edit': ['SUPER_ADMIN', 'ADMIN', 'OPS'],
  'vehicles.delete': ['SUPER_ADMIN', 'ADMIN'],
  'fareRules.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  'fareRules.edit': ['SUPER_ADMIN', 'ADMIN'],
  'refunds.view': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  'refunds.issue': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  'refunds.reconcile': ['SUPER_ADMIN'],
  'webhooks.view': ['SUPER_ADMIN', 'ADMIN'],
  'webhooks.replay': ['SUPER_ADMIN', 'ADMIN'],
  'audit.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  'users.manage': ['SUPER_ADMIN'],
  'alerts.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'],
  'alerts.manage': ['SUPER_ADMIN', 'ADMIN', 'OPS'],
  'pricing.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE'],
  'pricing.manage': ['SUPER_ADMIN', 'ADMIN'],
  'analytics.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE'],
  'finance.view': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  'finance.payout': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  'emi.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE'],
  'emi.manage': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  'reviews.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'SUPPORT'],
  'reviews.moderate': ['SUPER_ADMIN', 'ADMIN', 'OPS'],
  'cities.view': ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE'],
  'cities.manage': ['SUPER_ADMIN'],
} as const satisfies Record<string, AdminRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: AdminRole | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly AdminRole[]).includes(role);
}
