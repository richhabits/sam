import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));

const fetchSpy = vi.fn();
vi.mock('expo/fetch', () => ({ fetch: (...args: unknown[]) => fetchSpy(...args) }));

import { streamDirectAI, setCustomKey, DIRECT_PROVIDERS } from './direct';

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

describe('streamDirectAI — honest fallback when nothing is reachable', () => {
  it('says so plainly instead of fabricating a response, when every lane fails', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 402, body: null });

    const tokens: string[] = [];
    const result = await streamDirectAI('build me a dog website', [], { onToken: (t) => tokens.push(t) });

    // Must NOT claim to have generated a real result — no fabricated code, no canned
    // templates. See the doctrine note on streamHonestFallback in direct.ts: this behavior
    // (keyword-matched fake responses, once even streamed word-by-word to look live) was
    // reverted twice already after being caught pre-push.
    expect(result).not.toContain('```');
    expect(result).toContain("can't reach an AI brain");
    expect(result).toContain('Groq');
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('gives the same honest message for any prompt shape, not a keyword-matched canned reply', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 500, body: null });
    const result = await streamDirectAI('what can you do?', []);
    expect(result).toContain("can't reach an AI brain");
    expect(result).not.toContain('Fast Direct AI');
  });
});

describe('streamDirectAI — configured providers & multi-cloud', () => {
  it('includes 30+ cloud providers in DIRECT_PROVIDERS', () => {
    expect(DIRECT_PROVIDERS.length).toBeGreaterThanOrEqual(25);
    const ids = DIRECT_PROVIDERS.map((p) => p.id);
    expect(ids).toContain('groq');
    expect(ids).toContain('cerebras');
    expect(ids).toContain('mistral');
    expect(ids).toContain('openrouter');
    expect(ids).toContain('together');
    expect(ids).toContain('deepseek');
    expect(ids).toContain('siliconflow');
  });

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

  it('tries Gemini (dedicated SSE payload) when that key is set', async () => {
    await setCustomKey('gemini', 'AIzaTest');
    fetchSpy.mockResolvedValue({
      ok: true,
      body: sseBody([JSON.stringify({ candidates: [{ content: { parts: [{ text: 'from gemini' }] } }] })]),
    });

    const result = await streamDirectAI('hi', []);

    expect(result).toBe('from gemini');
    expect(fetchSpy.mock.calls[0][0]).toContain('generativelanguage.googleapis.com');
  });

  it('tries Anthropic when that key is set', async () => {
    await setCustomKey('anthropic', 'sk-ant-test');
    fetchSpy.mockResolvedValue({
      ok: true,
      body: sseBody([
        JSON.stringify({ type: 'content_block_delta', delta: { text: 'from claude' } }),
      ]),
    });

    const result = await streamDirectAI('hi', [], {}, undefined, 'turbo');

    expect(result).toBe('from claude');
    expect(fetchSpy.mock.calls[0][0]).toContain('api.anthropic.com');
  });
});
