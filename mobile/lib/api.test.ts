import { beforeEach, describe, expect, it, vi } from 'vitest';

// claim() had no test at all, and it shipped a ReferenceError (`init` used but never a
// parameter of the function) that threw on every single call — the pairing flow was broken
// for every user, QR or manual, until this was caught by hand. This file exists so that
// regression can't happen silently again.

const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios', isPad: false } }));
vi.mock('./notify', () => ({ registerForExpoPushAsync: vi.fn() }));

import { claim, getHost, getToken } from './api';

beforeEach(() => {
  store.clear();
  vi.restoreAllMocks();
});

describe('claim() actually completes a pairing request', () => {
  it('posts the code, stores the host and token, without throwing', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'tok_abc123' }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await claim('http://192.168.1.5:8787', 'deadbeefdeadbeefdeadbeefdeadbeef');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://192.168.1.5:8787/api/pair/claim');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(await getHost()).toBe('http://192.168.1.5:8787');
    expect(await getToken()).toBe('tok_abc123');
  });

  it('surfaces a server-side rejection as an ApiError, not a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'bad code' }) }),
    );
    await expect(claim('http://192.168.1.5:8787', 'deadbeefdeadbeefdeadbeefdeadbeef')).rejects.toMatchObject({
      status: 401,
      message: 'bad code',
    });
  });

  it('fetchBrainTelemetry fetches live cognition telemetry through authenticated api()', async () => {
    const { fetchBrainTelemetry, setHost } = await import('./api');
    await setHost('http://127.0.0.1:8787');
    store.set('sam.token', 'test_token');

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ totalInvocations: 42, isFullyGrounded: true }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const data = await fetchBrainTelemetry();
    expect(data.totalInvocations).toBe(42);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/brain/cognition/telemetry',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test_token' }),
      })
    );
  });

  // These four shipped pointing at endpoints that don't exist on the server at all
  // (/api/flipit/scale/risk, /api/revenue/opportunities, /api/yard/tasks, /api/voice/session)
  // — every call would have 404'd. There was no test for any of them, so nothing caught it.
  // Pinned to the real registered routes here so a future rename can't silently drift again.
  it('fetchFlipItRiskShield calls the real, parameterless signals route', async () => {
    const { fetchFlipItRiskShield, setHost } = await import('./api');
    await setHost('http://127.0.0.1:8787');
    store.set('sam.token', 'test_token');

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ signals: [] }) });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchFlipItRiskShield();
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:8787/api/flipit/signals', expect.anything());
  });

  it('fetchRevenueOpportunities POSTs to the real /api/revenue/hunt route', async () => {
    const { fetchRevenueOpportunities, setHost } = await import('./api');
    await setHost('http://127.0.0.1:8787');
    store.set('sam.token', 'test_token');

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchRevenueOpportunities();
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/revenue/hunt',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('fetchYardTasks calls the real /api/yard route', async () => {
    const { fetchYardTasks, setHost } = await import('./api');
    await setHost('http://127.0.0.1:8787');
    store.set('sam.token', 'test_token');

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ on: true }) });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchYardTasks();
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:8787/api/yard', expect.anything());
  });

  it('fetchVoiceSessionState calls the real /api/voice/status route', async () => {
    const { fetchVoiceSessionState, setHost } = await import('./api');
    await setHost('http://127.0.0.1:8787');
    store.set('sam.token', 'test_token');

    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal('fetch', fetchSpy);

    await fetchVoiceSessionState();
    expect(fetchSpy).toHaveBeenCalledWith('http://127.0.0.1:8787/api/voice/status', expect.anything());
  });
});
