import { describe, it, expect } from 'vitest';

import { compareVersions, isForceUpdate, isUpdateAvailable } from '../src/modules/mobile/mobile-config.service.js';

describe('compareVersions (pure)', () => {
  it('orders by major.minor.patch', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('treats missing segments as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.1')).toBe(-1);
  });

  it('treats non-numeric segments as zero', () => {
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
  });
});

describe('force-update / update-available gates (pure)', () => {
  it('forces update strictly below minSupported', () => {
    expect(isForceUpdate('0.6.9', '0.7.0')).toBe(true);
    expect(isForceUpdate('0.7.0', '0.7.0')).toBe(false);
    expect(isForceUpdate('0.7.1', '0.7.0')).toBe(false);
  });

  it('shows soft update when below latest', () => {
    expect(isUpdateAvailable('0.7.0', '0.8.0')).toBe(true);
    expect(isUpdateAvailable('0.8.0', '0.8.0')).toBe(false);
  });
});
