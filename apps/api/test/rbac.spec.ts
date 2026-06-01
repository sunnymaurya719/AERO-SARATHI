import { describe, it, expect } from 'vitest';
import type { AdminRole } from '@aero/db';
import { can, PERMISSIONS, type Permission } from '../src/rbac/matrix.js';

const ALL_ROLES: AdminRole[] = ['SUPER_ADMIN', 'ADMIN', 'OPS', 'FINANCE', 'SUPPORT'];

describe('RBAC matrix', () => {
  it('SUPER_ADMIN can do everything in the matrix', () => {
    for (const perm of Object.keys(PERMISSIONS) as Permission[]) {
      expect(can('SUPER_ADMIN', perm)).toBe(true);
    }
  });

  it('only SUPER_ADMIN can manage users', () => {
    expect(can('SUPER_ADMIN', 'users.manage')).toBe(true);
    expect(can('ADMIN', 'users.manage')).toBe(false);
    expect(can('OPS', 'users.manage')).toBe(false);
    expect(can('FINANCE', 'users.manage')).toBe(false);
    expect(can('SUPPORT', 'users.manage')).toBe(false);
  });

  it('only SUPER_ADMIN can reconcile refunds', () => {
    expect(can('SUPER_ADMIN', 'refunds.reconcile')).toBe(true);
    for (const r of ['ADMIN', 'OPS', 'FINANCE', 'SUPPORT'] as AdminRole[]) {
      expect(can(r, 'refunds.reconcile')).toBe(false);
    }
  });

  it('all roles can view the dashboard', () => {
    for (const r of ALL_ROLES) expect(can(r, 'dashboard.view')).toBe(true);
  });

  it('FINANCE can issue refunds but OPS and SUPPORT cannot', () => {
    expect(can('FINANCE', 'refunds.issue')).toBe(true);
    expect(can('OPS', 'refunds.issue')).toBe(false);
    expect(can('SUPPORT', 'refunds.issue')).toBe(false);
  });

  it('OPS can transition bookings and assign drivers', () => {
    expect(can('OPS', 'bookings.transition')).toBe(true);
    expect(can('OPS', 'bookings.assignDriver')).toBe(true);
  });

  it('SUPPORT cannot transition bookings or edit drivers', () => {
    expect(can('SUPPORT', 'bookings.transition')).toBe(false);
    expect(can('SUPPORT', 'drivers.edit')).toBe(false);
  });

  it('only SUPER_ADMIN and ADMIN can edit fare rules', () => {
    expect(can('SUPER_ADMIN', 'fareRules.edit')).toBe(true);
    expect(can('ADMIN', 'fareRules.edit')).toBe(true);
    expect(can('OPS', 'fareRules.edit')).toBe(false);
    expect(can('FINANCE', 'fareRules.edit')).toBe(false);
    expect(can('SUPPORT', 'fareRules.edit')).toBe(false);
  });

  it('only SUPER_ADMIN and ADMIN can view/replay webhooks', () => {
    for (const perm of ['webhooks.view', 'webhooks.replay'] as Permission[]) {
      expect(can('SUPER_ADMIN', perm)).toBe(true);
      expect(can('ADMIN', perm)).toBe(true);
      expect(can('OPS', perm)).toBe(false);
      expect(can('FINANCE', perm)).toBe(false);
      expect(can('SUPPORT', perm)).toBe(false);
    }
  });

  it('only SUPER_ADMIN and ADMIN can delete drivers and vehicles', () => {
    for (const perm of ['drivers.delete', 'vehicles.delete'] as Permission[]) {
      expect(can('SUPER_ADMIN', perm)).toBe(true);
      expect(can('ADMIN', perm)).toBe(true);
      expect(can('OPS', perm)).toBe(false);
    }
  });

  it('refundOverride is limited to SUPER_ADMIN and ADMIN', () => {
    expect(can('SUPER_ADMIN', 'bookings.refundOverride')).toBe(true);
    expect(can('ADMIN', 'bookings.refundOverride')).toBe(true);
    expect(can('OPS', 'bookings.refundOverride')).toBe(false);
    expect(can('FINANCE', 'bookings.refundOverride')).toBe(false);
  });

  it('every permission lists at least one role', () => {
    for (const perm of Object.keys(PERMISSIONS) as Permission[]) {
      expect(PERMISSIONS[perm].length).toBeGreaterThan(0);
    }
  });
});
