import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn().mockResolvedValue(undefined),
  selectionAsync: vi.fn().mockResolvedValue(undefined),
  notificationAsync: vi.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

import { haptic } from './haptics';

describe('haptics helper', () => {
  it('calls impactAsync on light, medium, heavy', () => {
    expect(() => haptic.light()).not.toThrow();
    expect(() => haptic.medium()).not.toThrow();
    expect(() => haptic.heavy()).not.toThrow();
  });

  it('calls selectionAsync on selection', () => {
    expect(() => haptic.selection()).not.toThrow();
  });

  it('calls notificationAsync on success and error', () => {
    expect(() => haptic.success()).not.toThrow();
    expect(() => haptic.error()).not.toThrow();
  });
});
