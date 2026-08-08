import { describe, it, expect, beforeEach, vi } from 'vitest';

// The point of this file: prove the demo is AIRTIGHT. A reviewer opening the app with no SAM
// anywhere must not generate a single request — not a failed one, not a timing-out one. If a
// transport ever forgets the demo check, the app tries the network, hangs, and demonstrates
// exactly the brokenness the demo exists to avoid.

const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));
// react-native is only consulted for the client-hint string; nothing here needs a real one.
vi.mock('react-native', () => ({ Platform: { OS: 'ios', isPad: false } }));

import { api } from './api';
import { enterDemo, leaveDemo } from './demo';

const fetchSpy = vi.fn();

beforeEach(async () => {
  store.clear();
  await leaveDemo();
  fetchSpy.mockReset();
  fetchSpy.mockRejectedValue(new Error('the demo must never reach the network'));
  vi.stubGlobal('fetch', fetchSpy);
});

describe('in demo mode nothing reaches the network', () => {
  it('answers every screen\'s path without a single fetch', async () => {
    await enterDemo();
    for (const path of ['/api/yard', '/api/pair/devices', '/api/connectors', '/api/yard/job/demo_job_teahouse']) {
      const body = await api(path);
      expect(body).toBeTruthy();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers even for a path it has no data for, instead of falling through to fetch', async () => {
    await enterDemo();
    await expect(api('/api/invented/later')).resolves.toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does NOT swallow the real path — out of demo, an unpaired call still refuses', async () => {
    // The mirror of the above. If the demo check were written too broadly it would make the
    // real app fake success while unpaired, which is a far worse bug than the one it fixes.
    await expect(api('/api/yard')).rejects.toMatchObject({ status: 401 });
    expect(fetchSpy).not.toHaveBeenCalled();   // refused before any request, as before
  });
});
