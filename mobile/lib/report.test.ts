import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
}));

import { reportRecord } from './report';

describe('reportRecord', () => {
  it('keeps a real reason and the reply', () => {
    expect(reportRecord('harmful', '  this reply  ')).toEqual({ reason: 'harmful', text: 'this reply' });
  });

  it('refuses an unknown reason or an empty reply', () => {
    expect(reportRecord('spam', 'text')).toBeNull();
    expect(reportRecord('other', '   ')).toBeNull();
  });
});
