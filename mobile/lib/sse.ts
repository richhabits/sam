// SSE framing, kept deliberately free of any transport import.
//
// chat.ts pulls in `expo/fetch`, which only resolves inside the RN runtime — so anything
// importing chat.ts is untestable from Node. This is the part with the actual logic in it,
// so it lives on its own and the test suite (which runs on Node, from the repo root) can
// reach it. Transport goes in chat.ts; decisions go here.

export type StreamEvent =
  | { type: 'route'; tier?: string; klass?: string; reason?: string; cached?: boolean }
  | { type: 'token'; t: string }
  | { type: 'done'; text?: string; provider?: string; cached?: boolean }
  | { type: 'end'; projectId?: string }
  | { type: string; [k: string]: unknown };

/**
 * Pull whole SSE frames out of a growing buffer.
 *
 * Chunk boundaries land wherever the network puts them — mid-JSON, mid-frame, even mid-UTF8
 * character — so anything not terminated by a blank line is NOT yet a message and must stay
 * in the buffer. Returning the remainder rather than dropping it is the entire contract here;
 * getting it wrong drops or corrupts tokens only under load, which is the worst way to find out.
 */
export function parseFrames(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? ''; // trailing partial frame — always incomplete
  for (const frame of parts) {
    for (const line of frame.split('\n')) {
      if (!line.startsWith('data:')) continue; // comments/keep-alives aren't payload
      const raw = line.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        events.push(JSON.parse(raw) as StreamEvent);
      } catch {
        // A frame that isn't JSON is a server-side bug, not something to crash the chat over.
      }
    }
  }
  return { events, rest };
}
