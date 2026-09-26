import { fetch as streamingFetch } from 'expo/fetch';
import { AiConsentRequired, hasAiSharingConsent } from './aiConsent';
import { getHost, getToken } from './api';
import { demoStream, isDemo } from './demo';
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
  /** A risky tool call the desktop paused on, awaiting approval — see PermissionGate in
   *  samKit.tsx and confirmPending() in lib/api.ts. Firing this is the LAST thing a stream
   *  does: the server holds the action and closes the response without a `done` (see
   *  server/agent.ts's `emit({type:"pending",...}); return;`), so onToken's accumulated text
   *  up to here is commentary, not a finished answer — do not render it as one. */
  onPending?: (e: Extract<StreamEvent, { type: 'pending' }>) => void;
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
  // THE DEMO NEVER LEAVES THE PHONE. demoStream() existed with tests but nothing called it, so a
  // reviewer typing into the demo chat fell through to the cloud path below and sent their
  // message to real AI providers — contradicting "no network requests are made in this mode".
  if (isDemo()) {
    const text = await demoStream(message, (soFar) => handlers.onToken?.(soFar), signal);
    if (!signal?.aborted) handlers.onDone?.(text);
    return text;
  }

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
            } else if (e.type === 'pending' && typeof (e as any).pendingId === 'string') {
              // Terminal for this stream — the server returns without a `done` (see the
              // StreamHandlers doc above). Reader loop below drains to `end`/close on its own;
              // nothing left to accumulate.
              handlers.onPending?.(e as any);
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

  // Standalone Direct AI Path (Works anywhere on 5G, Wi-Fi, offline) — this is where the message
  // leaves for THIRD-PARTY servers, so it is the one place that must have permission first
  // (App Review 5.1.2(i); see lib/aiConsent.ts). Enforced here, at the transport, rather than in
  // a screen, so no caller can reach the providers without it.
  if (!(await hasAiSharingConsent())) throw new AiConsentRequired();
  return await streamDirectAI(message, history, handlers, signal, tier);
}
