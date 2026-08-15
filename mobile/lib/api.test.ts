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
});
