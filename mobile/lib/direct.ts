import { fetch as streamingFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import type { Turn, StreamHandlers } from './chat';

// STANDALONE DIRECT AI ENGINE FOR SAM MOBILE
//
// Allows SAM to function as a 100% full-featured AI Assistant directly on iOS / Android
// without needing a running Mac or laptop. When a desktop is paired and reachable, SAM uses
// the desktop's local yard/tools; when on 5G or standalone, SAM streams from cloud brains.

const CUSTOM_KEY_GROQ = 'sam.key.groq';
const CUSTOM_KEY_OPENROUTER = 'sam.key.openrouter';
const CUSTOM_KEY_GEMINI = 'sam.key.gemini';
const CUSTOM_KEY_OPENAI = 'sam.key.openai';
const _CUSTOM_MODEL = 'sam.model.custom';

export async function getCustomKey(provider: 'groq' | 'openrouter' | 'gemini' | 'openai'): Promise<string | null> {
  try {
    const keyMap = {
      groq: CUSTOM_KEY_GROQ,
      openrouter: CUSTOM_KEY_OPENROUTER,
      gemini: CUSTOM_KEY_GEMINI,
      openai: CUSTOM_KEY_OPENAI,
    };
    return await SecureStore.getItemAsync(keyMap[provider]);
  } catch {
    return null;
  }
}

export async function setCustomKey(provider: 'groq' | 'openrouter' | 'gemini' | 'openai', key: string): Promise<void> {
  try {
    const keyMap = {
      groq: CUSTOM_KEY_GROQ,
      openrouter: CUSTOM_KEY_OPENROUTER,
      gemini: CUSTOM_KEY_GEMINI,
      openai: CUSTOM_KEY_OPENAI,
    };
    if (key.trim()) {
      await SecureStore.setItemAsync(keyMap[provider], key.trim());
    } else {
      await SecureStore.deleteItemAsync(keyMap[provider]);
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

/**
 * Stream an AI completion directly from cloud providers on mobile.
 */
export async function streamDirectAI(
  message: string,
  history: Turn[],
  handlers: StreamHandlers = {},
  signal?: AbortSignal,
  tier?: 'free' | 'turbo',
): Promise<string> {
  const [groqKey, openrouterKey, openaiKey] = await Promise.all([
    getCustomKey('groq'),
    getCustomKey('openrouter'),
    getCustomKey('openai'),
  ]);

  handlers.onRoute?.({
    type: 'route',
    tier: tier === 'turbo' ? 'turbo · direct' : 'free · direct',
    reason: groqKey ? 'Groq AI' : openrouterKey ? 'OpenRouter' : openaiKey ? 'OpenAI' : 'SAM Cloud AI',
  });

  const messages = [
    { role: 'system', content: SAM_SYSTEM_PROMPT },
    ...history.slice(-8).map((t) => ({
      role: t.role === 'sam' ? 'assistant' : 'user',
      content: t.text,
    })),
    { role: 'user', content: message },
  ];

  // Configure endpoint and auth
  let url = 'https://api.groq.com/openai/v1/chat/completions';
  let model = 'llama-3.3-70b-versatile';
  let authHeader = '';

  if (groqKey) {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    model = 'llama-3.3-70b-versatile';
    authHeader = `Bearer ${groqKey}`;
  } else if (openrouterKey) {
    url = 'https://openrouter.ai/api/v1/chat/completions';
    model = tier === 'turbo' ? 'anthropic/claude-3.5-sonnet' : 'meta-llama/llama-3.3-70b-instruct:free';
    authHeader = `Bearer ${openrouterKey}`;
  } else if (openaiKey) {
    url = 'https://api.openai.com/v1/chat/completions';
    model = tier === 'turbo' ? 'gpt-4o' : 'gpt-4o-mini';
    authHeader = `Bearer ${openaiKey}`;
  } else {
    // Default SAM Cloud Public Lane (OpenRouter / Free Cerebras / Cloud Gateway)
    // We use OpenRouter's free tier or public endpoint
    url = 'https://openrouter.ai/api/v1/chat/completions';
    model = 'meta-llama/llama-3.3-70b-instruct:free';
    authHeader = '';
  }

  try {
    const res = await streamingFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
        'HTTP-Referer': 'https://github.com/richhabits/sam',
        'X-Title': 'SAM Mobile',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: 2048,
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      // If direct request fails (e.g. key missing/rate limit), provide intelligent local response
      return streamSimulatedAssistant(message, handlers, signal);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';

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
          const parsed = JSON.parse(dataStr);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) {
            accumulatedText += delta;
            handlers.onToken?.(accumulatedText);
          }
        } catch {
          // ignore partial JSON chunks
        }
      }
    }

    if (!accumulatedText.trim()) {
      return streamSimulatedAssistant(message, handlers, signal);
    }

    handlers.onDone?.(accumulatedText);
    return accumulatedText;
  } catch (err: any) {
    if (signal?.aborted) throw err;
    return streamSimulatedAssistant(message, handlers, signal);
  }
}

/**
 * Nothing reachable — no custom key, the keyless OpenRouter call failed, no desktop paired.
 * Say so plainly and give the two real ways to fix it, instead of fabricating a plausible-
 * looking answer. This used to keyword-match the prompt ("site"/"build"/"html" → a hardcoded
 * dog-website template, anything else → a canned "I'm SAM, ready to help" blurb) and stream it
 * word-by-word with an artificial 18ms/word delay to look like a real generation. That's the one
 * thing SAM's own doctrine rules out by name — PROVE IT: never claim a result you don't actually
 * have — and it meant "no AI is currently reachable" was invisible to the user, indistinguishable
 * from a real (if generic) reply.
 */
async function streamSimulatedAssistant(
  _prompt: string,
  handlers: StreamHandlers = {},
  _signal?: AbortSignal,
): Promise<string> {
  const message =
    "I can't reach an AI brain right now — no free key is set up on this phone, and the keyless " +
    'public lane just failed too. Two ways to fix it: add a free key in Settings → Cloud AI Engine ' +
    "(Groq's takes about 30 seconds), or pair this phone with your Mac/PC and use its brains instead.";
  handlers.onToken?.(message);
  handlers.onDone?.(message);
  return message;
}
