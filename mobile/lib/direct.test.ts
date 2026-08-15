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

import { streamDirectAI, setCustomKey } from './direct';

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) { controller.close(); return; }
      controller.enqueue(enc.encode(`data: ${chunks[i++]}\n\n`));
    },
  });
}
const okChunk = (text: string) => JSON.stringify({ choices: [{ delta: { content: text } }] });

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

describe('streamDirectAI — configured providers', () => {
  it('uses a configured key and streams the real response', async () => {
    await setCustomKey('groq', 'gsk_test123');
    fetchSpy.mockResolvedValue({ ok: true, body: sseBody([okChunk('Hello'), okChunk(' world'), '[DONE]']) });

    const result = await streamDirectAI('hi', []);

    expect(result).toBe('Hello world');
    expect(fetchSpy.mock.calls[0][0]).toContain('api.groq.com');
  });

  it('falls through to the next configured provider when the first fails', async () => {
    await setCustomKey('groq', 'gsk_test123');
    await setCustomKey('cerebras', 'csk_test456');
    fetchSpy
      .mockResolvedValueOnce({ ok: false, status: 429, body: null })   // groq rate-limited
      .mockResolvedValueOnce({ ok: true, body: sseBody([okChunk('from cerebras'), '[DONE]']) });

    const result = await streamDirectAI('hi', []);

    expect(result).toBe('from cerebras');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toContain('api.groq.com');
    expect(fetchSpy.mock.calls[1][0]).toContain('api.cerebras.ai');
  });

  it('tries Gemini (a different request shape entirely) when that key is set', async () => {
    await setCustomKey('gemini', 'AIzaTest');
    fetchSpy.mockResolvedValue({
      ok: true,
      body: sseBody([JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] })]),
    });

    const result = await streamDirectAI('hi', []);

    expect(result).toBe('from gemini');
    expect(fetchSpy.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');
  });
});
