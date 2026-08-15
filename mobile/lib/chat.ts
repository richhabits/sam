import { fetch as streamingFetch } from 'expo/fetch';
import { getHost, getToken } from './api';
import { streamDirectAI } from './direct';
import { parseFrames, type StreamEvent } from './sse';

export { parseFrames, type StreamEvent } from './sse';

// THE HYBRID POCKET ENGINE
//
// 1. If paired with a Mac/PC on LAN/mesh: Streams live from your computer with full local tools & yard.
// 2. If standalone or away on 5G: Streams directly from cloud AI models with zero downtime or setup required.
// 3. Never throws a fatal crash or locks the user out with a broken connection error.

export type Turn = { role: 'user' | 'sam'; text: string };

export type StreamHandlers = {
  onRoute?: (e: Extract<StreamEvent, { type: 'route' }>) => void;
  onToken?: (text: string) => void;
  onDone?: (text: string) => void;
};

/**
 * Send one message and stream the answer back. Resolves with the final text once the server
 * closes; gracefully falls back to standalone cloud AI if the Mac is unreachable.
 */
export async function streamChat(
  message: string,
  history: Turn[],
  handlers: StreamHandlers = {},
  signal?: AbortSignal,
  tier?: 'free' | 'turbo',
): Promise<string> {
  const [host, token] = await Promise.all([getHost(), getToken()]);

  // If paired, attempt desktop stream first
  if (host && token) {
    try {
      const res = await streamingFetch(`${host}/api/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, history: history.slice(-10), ...(tier ? { tier } : {}) }),
        signal,
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        let finalText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, rest } = parseFrames(buffer);
          buffer = rest;
          for (const e of events) {
            if (e.type === 'route') handlers.onRoute?.(e as any);
            else if (e.type === 'token' && typeof (e as any).t === 'string') {
              text += (e as any).t;
              handlers.onToken?.(text);
            } else if (e.type === 'done') {
              finalText = (typeof (e as any).text === 'string' && (e as any).text) || text;
              handlers.onDone?.(finalText);
            }
          }
        }
        return finalText || text;
      }
    } catch (err: any) {
      if (signal?.aborted) throw err;
      // Network unreachable / Mac asleep / on 5G — fall back smoothly to Standalone Cloud AI below!
    }
  }

  // Standalone Direct AI Path (Works anywhere on 5G, Wi-Fi, offline)
  return await streamDirectAI(message, history, handlers, signal, tier);
}
