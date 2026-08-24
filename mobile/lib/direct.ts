import { fetch as streamingFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import type { Turn, StreamHandlers } from './chat';

// STANDALONE DIRECT AI ENGINE FOR SAM MOBILE
//
// Allows SAM to function as a 100% full-featured AI Assistant directly on iOS / Android
// without needing a running Mac or laptop. When a desktop is paired and reachable, SAM uses
// the desktop's local yard/tools; when on 5G or standalone, SAM streams from cloud brains.
//
// Every compatible OpenAI provider + Google Gemini + Anthropic Claude is supported directly
// on device. When opened fresh without any keys, SAM tries a cascade of real keyless public
// lanes (Pollinations, OpenRouter's free tier); if every one of them genuinely fails, SAM says
// so honestly (streamHonestFallback) rather than fabricating a response — see the doctrine note
// on that function.

export type DirectProvider = {
  id: string;
  label: string;
  baseURL: string;
  model: string;
  getKeyUrl: string;
  keyPlaceholder: string;
  starter?: boolean;
  note?: string;
};

export const DIRECT_PROVIDERS: DirectProvider[] = [
  // ── STARTERS (Fast, generous free tiers - 30 second setup) ────────────────
  { id: 'groq', label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', getKeyUrl: 'https://console.groq.com/keys', keyPlaceholder: 'gsk_...', starter: true, note: '⚡ Blazing fast 70B chat' },
  { id: 'cerebras', label: 'Cerebras', baseURL: 'https://api.cerebras.ai/v1', model: 'gpt-oss-120b', getKeyUrl: 'https://cloud.cerebras.ai', keyPlaceholder: 'csk-...', starter: true, note: '⚡ Ultra-high speed 120B reasoning' },
  { id: 'mistral', label: 'Mistral', baseURL: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', getKeyUrl: 'https://console.mistral.ai/api-keys', keyPlaceholder: 'paste key', starter: true, note: '✍️ European flagship models & chat' },
  { id: 'openrouter', label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'nvidia/nemotron-3-super-120b-a12b:free', getKeyUrl: 'https://openrouter.ai/keys', keyPlaceholder: 'sk-or-...', starter: true, note: '🌐 Multi-model hub & free models' },
  { id: 'together', label: 'Together AI', baseURL: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', getKeyUrl: 'https://api.together.xyz/settings/api-keys', keyPlaceholder: 'paste key', starter: true, note: '🧠 Heavy reasoning & FLUX' },
  { id: 'deepseek', label: 'DeepSeek', baseURL: 'https://api.deepseek.com', model: 'deepseek-chat', getKeyUrl: 'https://platform.deepseek.com/api_keys', keyPlaceholder: 'paste key', starter: true, note: '🧠 Deep reasoning & elite code' },
  { id: 'sambanova', label: 'SambaNova', baseURL: 'https://api.sambanova.ai/v1', model: 'Meta-Llama-3.3-70B-Instruct', getKeyUrl: 'https://cloud.sambanova.ai', keyPlaceholder: 'paste key', starter: true, note: '⚡ High speed Llama 3.3 70B' },
  { id: 'novita', label: 'Novita', baseURL: 'https://api.novita.ai/v3/openai', model: 'meta-llama/llama-3.1-70b-instruct', getKeyUrl: 'https://novita.ai/settings/key-management', keyPlaceholder: 'paste key', starter: true, note: '🎬 Fast generation & chat' },
  { id: 'siliconflow', label: 'SiliconFlow', baseURL: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', getKeyUrl: 'https://cloud.siliconflow.cn/account/ak', keyPlaceholder: 'paste key', starter: true, note: '🎨 DeepSeek V3 free tier' },
  { id: 'zhipu', label: 'Zhipu GLM', baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', getKeyUrl: 'https://open.bigmodel.cn', keyPlaceholder: 'paste key', starter: true, note: '💻 Top coder, 1M context' },
  { id: 'alibaba', label: 'Qwen (Alibaba)', baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', getKeyUrl: 'https://bailian.console.alibabacloud.com', keyPlaceholder: 'paste key', starter: true, note: '🧠 Strong reasoning' },

  // ── EXTENDED FREE / CLOUD PROVIDERS ──────────────────────────────────────
  { id: 'fireworks', label: 'Fireworks', baseURL: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama-v3p1-70b-instruct', getKeyUrl: 'https://fireworks.ai/account/api-keys', keyPlaceholder: 'paste key', note: '💻 Code & fast models' },
  { id: 'nebius', label: 'Nebius', baseURL: 'https://api.studio.nebius.ai/v1', model: 'meta-llama/Meta-Llama-3.1-70B-Instruct', getKeyUrl: 'https://studio.nebius.com', keyPlaceholder: 'paste key', note: '💬 Open models cloud' },
  { id: 'hyperbolic', label: 'Hyperbolic', baseURL: 'https://api.hyperbolic.xyz/v1', model: 'meta-llama/Meta-Llama-3.1-70B-Instruct', getKeyUrl: 'https://app.hyperbolic.xyz/settings', keyPlaceholder: 'paste key', note: '💬 General chat' },
  { id: 'cohere', label: 'Cohere', baseURL: 'https://api.cohere.com/v2', model: 'command-r-plus', getKeyUrl: 'https://dashboard.cohere.com/api-keys', keyPlaceholder: 'paste key', note: '✍️ Writing & search style' },
  { id: 'xai', label: 'xAI (Grok)', baseURL: 'https://api.x.ai/v1', model: 'grok-2-latest', getKeyUrl: 'https://console.x.ai', keyPlaceholder: 'paste key', note: '💬 Grok chat' },
  { id: 'huggingface', label: 'HuggingFace', baseURL: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', getKeyUrl: 'https://huggingface.co/settings/tokens', keyPlaceholder: 'hf_...', note: '🌐 Many open models' },
  { id: 'ai21', label: 'AI21', baseURL: 'https://api.ai21.com/studio/v1', model: 'jamba-1.5-mini', getKeyUrl: 'https://studio.ai21.com/account/api-key', keyPlaceholder: 'paste key', note: '✍️ Jamba writing' },
  { id: 'upstage', label: 'Upstage', baseURL: 'https://api.upstage.ai/v1/solar', model: 'solar-mini', getKeyUrl: 'https://console.upstage.ai/api-keys', keyPlaceholder: 'paste key', note: '💬 Solar quick chat' },
  { id: 'perplexity', label: 'Perplexity', baseURL: 'https://api.perplexity.ai', model: 'sonar', getKeyUrl: 'https://www.perplexity.ai/settings/api', keyPlaceholder: 'paste key', note: '🔍 Web-aware answers' },
  { id: 'volcengine', label: 'Doubao (Volcengine)', baseURL: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-pro-32k', getKeyUrl: 'https://console.volcengine.com/ark', keyPlaceholder: 'paste key', note: '💬 ByteDance Doubao' },
  { id: 'minimax', label: 'MiniMax', baseURL: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat', getKeyUrl: 'https://platform.minimaxi.com', keyPlaceholder: 'paste key', note: '💬 MiniMax chat' },
  { id: 'deepinfra', label: 'DeepInfra', baseURL: 'https://api.deepinfra.com/v1/openai', model: 'meta-llama/Meta-Llama-3.3-70B-Instruct', getKeyUrl: 'https://deepinfra.com/dash/api_keys', keyPlaceholder: 'paste key', note: '🌐 Open models' },
  { id: 'scaleway', label: 'Scaleway', baseURL: 'https://api.scaleway.ai/v1', model: 'llama-3.3-70b-instruct', getKeyUrl: 'https://console.scaleway.com', keyPlaceholder: 'paste key', note: '💬 EU-hosted cloud' },
  { id: 'chutes', label: 'Chutes', baseURL: 'https://chutes.ai/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', getKeyUrl: 'https://chutes.ai', keyPlaceholder: 'paste key', note: '🌐 Decentralised models' },
  { id: 'friendli', label: 'Friendli', baseURL: 'https://api.friendli.ai/serverless/v1', model: 'meta-llama-3.1-70b-instruct', getKeyUrl: 'https://suite.friendli.ai', keyPlaceholder: 'paste key', note: '💬 Fast serving' },
  { id: 'codestral', label: 'Codestral', baseURL: 'https://codestral.mistral.ai/v1', model: 'codestral-latest', getKeyUrl: 'https://console.mistral.ai/codestral', keyPlaceholder: 'paste key', note: '💻 Code specialist' },
  { id: 'vercel', label: 'Vercel AI Gateway', baseURL: 'https://ai-gateway.vercel.sh/v1', model: 'meta-llama/llama-3.3-70b-instruct', getKeyUrl: 'https://vercel.com/ai-gateway', keyPlaceholder: 'paste key', note: '🌐 AI Gateway' },
  { id: 'ovh', label: 'OVHcloud AI', baseURL: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', model: 'meta-llama/Meta-Llama-3.1-70B-Instruct', getKeyUrl: 'https://endpoints.ai.cloud.ovh.net', keyPlaceholder: 'paste key', note: '💬 EU-hosted free tier' },

  // ── PREMIUM TIERS ────────────────────────────────────────────────────────
  { id: 'openai', label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', getKeyUrl: 'https://platform.openai.com/api-keys', keyPlaceholder: 'sk-...', note: '👑 GPT-4o Mini & GPT-4o' },
];

export interface StandaloneProvider {
  id: string;
  label: string;
  getKeyUrl: string;
  keyPlaceholder: string;
  starter?: boolean;
  note?: string;
  baseURL?: string;
  model?: string;
}

export const GEMINI_PROVIDER: StandaloneProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  getKeyUrl: 'https://aistudio.google.com/apikey',
  keyPlaceholder: 'AIza...',
  starter: true,
  note: '👁 Vision & photos, 1M context',
};

export const ANTHROPIC_PROVIDER: StandaloneProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  getKeyUrl: 'https://console.anthropic.com/settings/keys',
  keyPlaceholder: 'sk-ant-...',
  starter: false,
  note: '👑 Claude 3.5 Sonnet & Haiku',
};

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

// Task-aware prompt classification
export type Lane = 'fast' | 'deep' | 'code';
export function pickLane(text: string): Lane {
  const t = (text || '').slice(0, 600).toLowerCase();
  if (/```|\b(debug|refactor|stack ?trace|compile|regex|typescript|javascript|python|\bnpm\b|traceback|exception|syntax error|stack overflow|code|html|css|react)\b/.test(t)) return 'code';
  if (t.length > 280 || /\b(analy[sz]e|explain why|strateg|compare\b|pros and cons|think through|break ?down|evaluate|deep dive|trade-?offs?|reason through|assess\b)\b/.test(t)) return 'deep';
  return 'fast';
}

// One caller for every OpenAI-compatible provider
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
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
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
        } catch { /* partial chunk */ }
      }
    }
    return accumulated.trim() ? accumulated : null;
  } catch (err: any) {
    if (signal?.aborted) throw err;
    return null;
  }
}

// Dedicated Google Gemini direct streaming
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
        } catch { /* partial chunk */ }
      }
    }
    return accumulated.trim() ? accumulated : null;
  } catch (err: any) {
    if (signal?.aborted) throw err;
    return null;
  }
}

// Dedicated Anthropic direct streaming
async function callAnthropicDirect(
  key: string,
  message: string,
  history: Turn[],
  handlers: StreamHandlers,
  signal?: AbortSignal,
  tier?: 'free' | 'turbo',
): Promise<string | null> {
  try {
    const model = tier === 'turbo' ? 'claude-3-5-sonnet-20241022' : 'claude-3-5-haiku-20241022';
    const res = await streamingFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: SAM_SYSTEM_PROMPT,
        stream: true,
        messages: [
          ...history.slice(-8).map((t) => ({ role: t.role === 'sam' ? 'assistant' : 'user', content: t.text })),
          { role: 'user', content: message },
        ],
      }),
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
        if (!trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        try {
          const evt = JSON.parse(dataStr);
          if (evt.type === 'content_block_delta' && evt.delta?.text) {
            accumulated += evt.delta.text;
            handlers.onToken?.(accumulated);
          }
        } catch { /* partial chunk */ }
      }
    }
    return accumulated.trim() ? accumulated : null;
  } catch (err: any) {
    if (signal?.aborted) throw err;
    return null;
  }
}

// ── HONEST FALLBACK ──────────────────────────────────────────────────────
// Nothing reachable — no custom key worked, every keyless public lane failed, no desktop
// paired. Say so plainly and give the two real ways to fix it, instead of fabricating a
// plausible-looking answer. This used to keyword-match the prompt ("site"/"build"/"html" → a
// hardcoded dog-website template, anything else → a canned "I'm SAM, ready to help" blurb) and
// stream it word-by-word with an artificial delay to look like a real generation — twice, once
// under the name "Instant Core" — and both times it was reverted. That's the one thing SAM's
// own doctrine rules out by name — PROVE IT: never claim a result you don't actually have —
// and it meant "no AI is currently reachable" was invisible to the user, indistinguishable
// from a real (if generic) reply.
async function streamHonestFallback(handlers: StreamHandlers = {}): Promise<string> {
  const message =
    "I can't reach an AI brain right now — no free key is set up on this phone, and the keyless " +
    'public lanes just failed too. Two ways to fix it: add a free key in Settings → Cloud AI Engine ' +
    "(Groq's takes about 30 seconds), or pair this phone with your Mac/PC and use its brains instead.";
  handlers.onToken?.(message);
  handlers.onDone?.(message);
  return message;
}

/**
 * Stream an AI completion directly on mobile.
 *
 * 1. Checks user's custom configured keys in priority order (fastest/generous free tiers first).
 * 2. If no custom keys (or all fail), tries a multi-lane keyless cascade (Pollinations, OpenRouter Free).
 * 3. If every real lane genuinely fails, says so honestly instead of fabricating a response.
 */
export async function streamDirectAI(
  message: string,
  history: Turn[],
  handlers: StreamHandlers = {},
  signal?: AbortSignal,
  tier?: 'free' | 'turbo',
): Promise<string> {
  const lane = pickLane(message);

  // 1. Retrieve all stored user keys
  const [geminiKey, anthropicKey, ...directKeys] = await Promise.all([
    getCustomKey('gemini'),
    getCustomKey('anthropic'),
    ...DIRECT_PROVIDERS.map((p) => getCustomKey(p.id)),
  ]);

  const configured = DIRECT_PROVIDERS
    .map((p, i) => ({ provider: p, key: directKeys[i] }))
    .filter((x): x is { provider: DirectProvider; key: string } => !!x.key);

  // Task-aware sorting for configured keys
  if (lane === 'code') {
    configured.sort((a, b) => {
      const aCode = /deepseek|zhipu|fireworks|together|mistral|codestral/i.test(a.provider.id) ? 1 : 0;
      const bCode = /deepseek|zhipu|fireworks|together|mistral|codestral/i.test(b.provider.id) ? 1 : 0;
      return bCode - aCode;
    });
  } else if (lane === 'deep') {
    configured.sort((a, b) => {
      const aDeep = /deepseek|zhipu|together|alibaba|cerebras/i.test(a.provider.id) ? 1 : 0;
      const bDeep = /deepseek|zhipu|together|alibaba|cerebras/i.test(b.provider.id) ? 1 : 0;
      return bDeep - aDeep;
    });
  }

  const messages = buildMessages(message, history);

  // 2. Try User Configured Keys (Gemini, Anthropic, or OpenAI-compatible)
  if (geminiKey) {
    handlers.onRoute?.({ type: 'route', tier: tier === 'turbo' ? 'turbo · direct' : 'free · direct', reason: 'Google Gemini' });
    const text = await callGeminiDirect(geminiKey, message, history, handlers, signal);
    if (text) { handlers.onDone?.(text); return text; }
  }

  if (anthropicKey && (tier === 'turbo' || configured.length === 0)) {
    handlers.onRoute?.({ type: 'route', tier: 'turbo · direct', reason: 'Anthropic Claude' });
    const text = await callAnthropicDirect(anthropicKey, message, history, handlers, signal, tier);
    if (text) { handlers.onDone?.(text); return text; }
  }

  for (const { provider, key } of configured) {
    handlers.onRoute?.({ type: 'route', tier: tier === 'turbo' ? 'turbo · direct' : 'free · direct', reason: provider.label });
    const model = provider.id === 'openai' && tier === 'turbo' ? 'gpt-4o'
      : provider.id === 'openrouter' && tier === 'turbo' ? 'anthropic/claude-3.5-sonnet'
      : provider.model;
    const text = await callOpenAICompatDirect(provider.baseURL, model, key, messages, handlers, signal);
    if (text) { handlers.onDone?.(text); return text; }
  }

  // 3. ZERO-CONFIG AUTONOMOUS PUBLIC CASCADE (When user has no keys set up yet)
  // Clean payload: fold SAM_SYSTEM_PROMPT into the user turn to avoid billing locks
  const anonMessages: ChatMessage[] = messages[0]?.role === 'system' && messages.length > 1
    ? [...messages.slice(1, -1), { role: 'user', content: `${messages[0].content}\n\n${messages[messages.length - 1].content}` }]
    : messages;

  // Lane A: Keyless Pollinations POST (openai-fast)
  handlers.onRoute?.({ type: 'route', tier: 'free · direct', reason: 'Pollinations Fast' });
  const anonFast = await callOpenAICompatDirect(
    'https://text.pollinations.ai/openai',
    'openai-fast',
    '',
    anonMessages,
    handlers,
    signal,
    {},
  ).catch(() => null);
  if (anonFast) { handlers.onDone?.(anonFast); return anonFast; }

  // Lane B: Keyless Pollinations POST (openai standard)
  const anonStandard = await callOpenAICompatDirect(
    'https://text.pollinations.ai/openai',
    'openai',
    '',
    anonMessages,
    handlers,
    signal,
    {},
  ).catch(() => null);
  if (anonStandard) { handlers.onDone?.(anonStandard); return anonStandard; }

  // Lane C: Keyless Pollinations GET endpoint (Independent code path)
  try {
    const getPrompt = `${SAM_SYSTEM_PROMPT}\n\nUser: ${message}\nSAM:`.slice(0, 2500);
    const getRes = await streamingFetch(
      `https://text.pollinations.ai/${encodeURIComponent(getPrompt)}?model=openai`,
      { method: 'GET', signal: signal ?? AbortSignal.timeout(6000) },
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
        if (text.trim() && !text.includes('402 Payment Required') && !text.includes('Queue full')) {
          handlers.onDone?.(text.trim());
          return text.trim();
        }
      }
    }
  } catch { /* proceed to next lane */ }

  // Lane D: OpenRouter Free Tier Fallback
  const openRouterFree = await callOpenAICompatDirect(
    'https://openrouter.ai/api/v1',
    'nvidia/nemotron-3-super-120b-a12b:free',
    '',
    anonMessages,
    handlers,
    signal,
  ).catch(() => null);
  if (openRouterFree) { handlers.onDone?.(openRouterFree); return openRouterFree; }

  // 4. Nothing reachable — say so honestly rather than fabricate a response.
  return streamHonestFallback(handlers);
}
