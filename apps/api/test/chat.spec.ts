import { describe, it, expect } from 'vitest';

import { chatWindow } from '../src/modules/chat/chat.service.js';

const now = new Date('2026-05-30T12:00:00.000Z');

describe('chatWindow (pure)', () => {
  it('is open during the live trip statuses', () => {
    expect(chatWindow('DRIVER_ASSIGNED', null, now, 24)).toBe('open');
    expect(chatWindow('EN_ROUTE', null, now, 24)).toBe('open');
    expect(chatWindow('ONGOING', null, now, 24)).toBe('open');
  });

  it('is closed before assignment and when cancelled', () => {
    expect(chatWindow('PENDING', null, now, 24)).toBe('closed');
    expect(chatWindow('CONFIRMED', null, now, 24)).toBe('closed');
    expect(chatWindow('CANCELLED', null, now, 24)).toBe('closed');
    expect(chatWindow('NO_SHOW', null, now, 24)).toBe('closed');
  });

  it('is read-only within the window after completion, then closed', () => {
    const completedAt = new Date(now.getTime() - 2 * 3_600_000); // 2h ago
    expect(chatWindow('COMPLETED', completedAt, now, 24)).toBe('readonly');

    const old = new Date(now.getTime() - 25 * 3_600_000); // 25h ago
    expect(chatWindow('COMPLETED', old, now, 24)).toBe('closed');
  });

  it('defaults to read-only when completedAt is missing', () => {
    expect(chatWindow('COMPLETED', null, now, 24)).toBe('readonly');
  });
});
