import { beforeEach, describe, expect, it, vi } from 'vitest';

// direct.ts had no test coverage at all — same gap class as lib/api.ts's claim() before it.
// This locks in the one behavior that actually matters here: when nothing is reachable (no
// custom key, the keyless public call fails), SAM must say so honestly rather than fabricate
// a plausible-looking canned answer. It used to keyword-match the prompt and stream a scripted
// reply (a hardcoded dog-website template for "site"/"build"/"html") with an artificial per-word
// delay to look like a real generation — indistinguishable from a real answer to the user.

const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));

const fetchSpy = vi.fn();
vi.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => fetchSpy(...args) }));

import { streamDirectAI } from './direct';

beforeEach(() => {
  store.clear();
  fetchSpy.mockReset();
});

describe('streamDirectAI — when nothing is reachable', () => {
  it('tells the user honestly instead of fabricating a canned reply', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, body: null });

    const tokens: string[] = [];
    const result = await streamDirectAI('build me a dog website', [], { onToken: (t) => tokens.push(t) });

    expect(result.toLowerCase()).toContain("can't reach an ai brain");
    expect(result).not.toContain('Paws & Co');
    expect(result).not.toContain('```html');
    // The old path streamed word-by-word with an 18ms/word artificial delay — this one doesn't
    // fake a generation, so it should resolve near-instantly.
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('gives the same honest message regardless of prompt content', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, body: null });
    const r1 = await streamDirectAI('what is the capital of France?', []);
    const r2 = await streamDirectAI('build me a website for my dog', []);
    expect(r1).toBe(r2);
  });
});
