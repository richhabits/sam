import { fetch as streamingFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import type { Turn, StreamHandlers } from './chat';

// STANDALONE DIRECT AI ENGINE FOR SAM MOBILE
//
// Allows SAM to function as a 100% full-featured AI Assistant directly on iOS / Android
// without needing a running Mac or laptop. When a desktop is paired and reachable, SAM uses
// the desktop's local yard/tools; when on 5G or standalone, SAM streams from cloud brains.
//
// The desktop app has its own provider registry (server/providers.registry.ts) with 40+ free
// providers — "src/ never imports from server/... there is only one list", fetched live over
// /api/admin/config. Mobile can't always assume a server is reachable (that's the whole point
// of standalone mode), so it can't just fetch that list — this is a deliberate, small, second
// list, limited to providers that (a) are genuinely OpenAI-compatible, so one caller covers all
// of them, and (b) SAM's own server already knows the correct base URL + model for, so these
// aren't guesses. Kept intentionally short rather than growing into an undocumented duplicate
// of the real registry.
export type DirectProvider = {
  id: string;
  label: string;
  baseURL: string;
  model: string;
  getKeyUrl: string;
  keyPlaceholder: string;
};

// Order = the priority streamDirectAI tries them in — fastest/most generous free tiers first,
// mirroring the "starter" providers server/providers.registry.ts marks for the same reason.
export const DIRECT_PROVIDERS: DirectProvider[] = [
  { id: 'groq', label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', getKeyUrl: 'https://console.groq.com/keys', keyPlaceholder: 'gsk_...' },
  { id: 'cerebras', label: 'Cerebras', baseURL: 'https://api.cerebras.ai/v1', model: 'gpt-oss-120b', getKeyUrl: 'https://cloud.cerebras.ai', keyPlaceholder: 'csk-...' },
  { id: 'together', label: 'Together AI', baseURL: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', getKeyUrl: 'https://api.together.xyz/settings/api-keys', keyPlaceholder: 'paste key' },
  { id: 'sambanova', label: 'SambaNova', baseURL: 'https://api.sambanova.ai/v1', model: 'Meta-Llama-3.3-70B-Instruct', getKeyUrl: 'https://cloud.sambanova.ai', keyPlaceholder: 'paste key' },
  { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', getKeyUrl: 'https://platform.deepseek.com/api_keys', keyPlaceholder: 'paste key' },
  { id: 'novita', label: 'Novita', baseURL: 'https://api.novita.ai/v3/openai', model: 'meta-llama/llama-3.1-70b-instruct', getKeyUrl: 'https://novita.ai/settings/key-management', keyPlaceholder: 'paste key' },
  { id: 'fireworks', label: 'Fireworks', baseURL: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama-v3p1-70b-instruct', getKeyUrl: 'https://fireworks.ai/account/api-keys', keyPlaceholder: 'paste key' },
  { id: 'mistral', label: 'Mistral', baseURL: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', getKeyUrl: 'https://console.mistral.ai/api-keys', keyPlaceholder: 'paste key' },
  { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', getKeyUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-...' },
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', getKeyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-...' },
];

// Gemini isn't OpenAI-compatible (different endpoint shape, different SSE envelope), so it's
// handled separately rather than forced into the shared caller.
export const GEMINI_PROVIDER = { id: 'gemini', label: 'Google Gemini', getKeyUrl: 'https://aistudio.google.com/apikey', keyPlaceholder: 'AIza...' };

function keyStoreKey(provider: string): string {
  return `sam.key.${provider}`;
}

export async function getCustomKey(provider: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(keyStoreKey(provider));
  } catch {
    return null;
  }
}

export async function setCustomKey(provider: string, key: string): Promise<void> {
  try {
    if (key.trim()) {
      await SecureStore.setItemAsync(keyStoreKey(provider), key.trim());
    } else {
      await SecureStore.deleteItemAsync(keyStoreKey(provider));
    }
  } catch {
    // secure store error
  }
}

const SAM_SYSTEM_PROMPT = `You are S.A.M. (Smart Artificial Mind), an elite, direct, and exceptionally capable AI assistant.
You are running on mobile and desktop devices.
You are concise, sharp, extremely knowledgeable, and write clean, modern, state-of-the-art code and clear explanations.
When asked to build websites, applications, or documents, write complete, production-ready, beautiful code.
Never give robotic excuses or refer to yourself as a restricted demo. You are the real SAM.`;

type ChatMessage = { role: string; content: string };

function buildMessages(message: string, history: Turn[]): ChatMessage[] {
  return [
    { role: 'system', content: SAM_SYSTEM_PROMPT },
    ...history.slice(-8).map((t) => ({ role: t.role === 'sam' ? 'assistant' : 'user', content: t.text })),
    { role: 'user', content: message },
  ];
}

// One caller for every OpenAI-compatible provider — base URL and model are the only things
// that differ between them. Returns null (rather than throwing) on any failure so the caller
// can try the next provider instead of falling straight to the honest-fallback message.
async function callOpenAICompatDirect(
  baseURL: string,
  model: string,
  key: string,
  messages: ChatMessage[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  extraBody: Record<string, unknown> = { temperature: 0.7, max_tokens: 2048 },
): Promise<string | null> {
  try {
    const res = await streamingFetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'https://github.com/richhabits/sam',
        'X-Title': 'SAM Mobile',
      },
      body: JSON.stringify({ model, messages, stream: true, ...extraBody }),
      signal,
    });
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed?.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;
        try {
          const delta = JSON.parse(dataStr)?.choices?.[0]?.delta?.content;
          if (delta) { accumulated += delta; handlers.onToken?.(accumulated); }
        } catch { /* partial JSON chunk — the next read fills it in */ }
      }
    }
    return accumulated.trim() ? accumulated : null;
  } catch (err: any) {
    if (signal?.aborted) throw err;
    return null;
  }
}

async function callGeminiDirect(
  key: string,
  message: string,
  history: Turn[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const res = await streamingFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SAM_SYSTEM_PROMPT }] },
          contents: [
            ...history.slice(-8).map((t) => ({ role: t.role === 'sam' ? 'model' : 'user', parts: [{ text: t.text }] })),
            { role: 'user', parts: [{ text: message }] },
          ],
          generationConfig: { maxOutputTokens: 2048 },
        }),
        signal,
      },
    );
    if (!res.ok || !res.body) return null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed?.startsWith('data:')) continue;
        try {
          const parts = JSON.parse(trimmed.slice(5).trim())?.candidates?.[0]?.content?.parts;
          const delta = parts?.map((p: any) => p.text).join('') || '';
          if (delta) { accumulated += delta; handlers.onToken?.(accumulated); }
        } catch { /* partial JSON chunk — the next read fills it in */ }
      }
    }
    return accumulated.trim() ? accumulated : null;
  } catch (err: any) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/**
 * Stream an AI completion directly from cloud providers on mobile. Tries every configured key
 * in priority order (fastest free tiers first), falling through to the next on failure rather
 * than giving up after one — a single rate-limited provider used to mean the whole request
 * failed even with three other working keys sitting unused.
 */
export async function streamDirectAI(
  message: string,
  history: Turn[],
  handlers: StreamHandlers = {},
  signal?: AbortSignal,
  tier?: 'free' | 'turbo',
): Promise<string> {
  const keys = await Promise.all(DIRECT_PROVIDERS.map((p) => getCustomKey(p.id)));
  const geminiKey = await getCustomKey('gemini');
  const configured = DIRECT_PROVIDERS.map((p, i) => ({ provider: p, key: keys[i] })).filter((x) => x.key);

  const first = configured[0]?.provider.label ?? (geminiKey ? 'Gemini' : 'SAM Cloud AI');
  handlers.onRoute?.({ type: 'route', tier: tier === 'turbo' ? 'turbo · direct' : 'free · direct', reason: first });

  const messages = buildMessages(message, history);

  if (geminiKey) {
    const text = await callGeminiDirect(geminiKey, message, history, handlers, signal);
    if (text) { handlers.onDone?.(text); return text; }
  }
  for (const { provider, key } of configured) {
    const model = provider.id === 'openai' && tier === 'turbo' ? 'gpt-4o'
      : provider.id === 'openrouter' && tier === 'turbo' ? 'anthropic/claude-3.5-sonnet'
      : provider.model;
    const text = await callOpenAICompatDirect(provider.baseURL, model, key as string, messages, handlers, signal);
    if (text) { handlers.onDone?.(text); return text; }
  }

  // Nothing configured (or every configured key failed) — try the anonymous public lane before
  // giving up. OpenRouter's keyless anonymous endpoint is permanently dead (401, cookie-auth
  // required as of 2026-08). Pollinations' text API is genuinely keyless for anonymous callers
  // ("user_tier":"anonymous") and is the same fallback the desktop server already relies on
  // (server/model-providers.ts) — mobile gets the same free lane.
  //
  // Constraint isolated by bisecting the payload (2026-08-24): a system-role message in the
  // request triggers Pollinations' paid-billing path — 402 "API key budget too low... has 0.0000"
  // — even though the same request with only user/assistant turns is free. Extra params
  // (temperature, max_tokens) correlated with failures too. The bare minimum that works reliably:
  // model + user/assistant messages only, no system role, no extra generation params.
  // Fold SAM_SYSTEM_PROMPT into the latest user turn instead of sending it as a system message.
  const anonMessages: ChatMessage[] = messages[0]?.role === 'system' && messages.length > 1
    ? [...messages.slice(1, -1), { role: 'user', content: `${messages[0].content}\n\n${messages[messages.length - 1].content}` }]
    : messages;

  // Lane 1: POST /openai (streaming, same as keyed providers but with no system role + no extras)
  const anon = await callOpenAICompatDirect(
    'https://text.pollinations.ai/openai',
    'openai-fast',
    '',
    anonMessages,
    handlers,
    signal,
    {},
  ).catch(() => null);
  if (anon) { handlers.onDone?.(anon); return anon; }

  // Lane 2: GET endpoint — a completely independent code path (different URL, non-streaming).
  // Desktop server already uses this as a separate fallback (callPollinationsGet). If the POST
  // endpoint hiccups, this independent lane can still answer.
  try {
    const getPrompt = `${SAM_SYSTEM_PROMPT}\n\nUser: ${message}\nSAM:`.slice(0, 3000);
    const getRes = await streamingFetch(
      `https://text.pollinations.ai/${encodeURIComponent(getPrompt)}?model=openai`,
      { method: 'GET', signal: signal ?? AbortSignal.timeout(30000) },
    );
    if (getRes.ok) {
      const reader = getRes.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let text = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          handlers.onToken?.(text);
        }
        if (text.trim()) { handlers.onDone?.(text.trim()); return text.trim(); }
      }
    }
  } catch { /* GET lane failed — fall through to honest fallback */ }

  return streamHonestFallback(handlers);
}

/**
 * Nothing reachable — no custom key worked, the keyless Pollinations call failed, no desktop
 * paired. Say so plainly and give the two real ways to fix it, instead of fabricating a
 * plausible-looking answer. This used to keyword-match the prompt ("site"/"build"/"html" → a
 * hardcoded dog-website template, anything else → a canned "I'm SAM, ready to help" blurb) and
 * stream it word-by-word with an artificial 18ms/word delay to look like a real generation.
 * That's the one thing SAM's own doctrine rules out by name — PROVE IT: never claim a result you
 * don't actually have — and it meant "no AI is currently reachable" was invisible to the user,
 * indistinguishable from a real (if generic) reply.
 */
async function streamHonestFallback(handlers: StreamHandlers = {}): Promise<string> {
  const message =
    "I can't reach an AI brain right now — no free key is set up on this phone, and the keyless " +
    'public lane just failed too. Two ways to fix it: add a free key in Settings → Cloud AI Engine ' +
    "(Groq's takes about 30 seconds), or pair this phone with your Mac/PC and use its brains instead.";
  handlers.onToken?.(message);
  handlers.onDone?.(message);
  return message;
}
