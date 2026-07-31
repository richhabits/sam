import { fetch as streamingFetch } from 'expo/fetch';
import { getHost, getToken, ApiError } from './api';
import { parseFrames, type StreamEvent } from './sse';

export { parseFrames, type StreamEvent } from './sse';

// THE POCKET CAN TALK NOW.
//
// The desk streams answers over POST /api/stream (SSE): route → token* → done → end.
// This is the phone's half of that. Two things make it different from the browser's:
//
//  1. RN's global fetch does not expose a readable body, so `expo/fetch` is used instead —
//     it is the one fetch in this runtime that streams rather than buffering to completion.
//     Without it every answer would appear in one lump after the model finished, which is
//     the whole reason the desk feels fast and a naive phone client does not.
//  2. Auth is the Bearer session in the Keychain, the carrier server-side
//     sessionTokenFromRequest() reads (server/pairing.ts) — identical trust to a paired
//     browser's cookie, nothing more.

export type Turn = { role: 'user' | 'sam'; text: string };

export type StreamHandlers = {
  onRoute?: (e: Extract<StreamEvent, { type: 'route' }>) => void;
  onToken?: (text: string) => void;
  onDone?: (text: string) => void;
};

/**
 * Send one message and stream the answer back. Resolves with the final text once the server
 * closes; rejects on transport/auth failure. Abort via the AbortSignal to stop generation.
 */
export async function streamChat(
  message: string,
  history: Turn[],
  handlers: StreamHandlers = {},
  signal?: AbortSignal,
): Promise<string> {
  const [host, token] = await Promise.all([getHost(), getToken()]);
  if (!host || !token) throw new ApiError(401, 'not paired');

  const res = await streamingFetch(`${host}/api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    // Only the last 10 turns matter (the server slices to that anyway) and each is capped
    // server-side at 1200 chars — no reason to ship a whole conversation over mobile data.
    body: JSON.stringify({ message, history: history.slice(-10) }),
    signal,
  });

  if (!res.ok) {
    const body: any = await res.json().catch(() => ({}));
    // 401 here means the operator revoked this device — the UI turns that into "pair again",
    // never into a provider error, because they are not the same problem.
    throw new ApiError(res.status, body?.error || `chat failed (${res.status})`);
  }
  if (!res.body) throw new ApiError(500, 'no stream from SAM');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finalText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    // stream:true keeps multi-byte characters intact across chunk boundaries — an emoji or
    // a — split down the middle otherwise renders as garbage mid-answer.
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseFrames(buffer);
    buffer = rest;
    for (const e of events) {
      if (e.type === 'route') handlers.onRoute?.(e as any);
      else if (e.type === 'token' && typeof (e as any).t === 'string') {
        text += (e as any).t;
        handlers.onToken?.(text);
      } else if (e.type === 'done') {
        // `done` carries the authoritative text — a cached hit sends it whole with no
        // preceding tokens, so trusting only the accumulator would render an empty answer.
        finalText = (typeof (e as any).text === 'string' && (e as any).text) || text;
        handlers.onDone?.(finalText);
      }
    }
  }
  return finalText || text;
}
