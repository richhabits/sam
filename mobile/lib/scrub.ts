// The BY-SHAPE half of server/scrub.ts, ported for the phone.
//
// Why a copy exists at all: a notification sits on a lock screen anyone nearby can glance at,
// and on iOS the *native layer* is what renders the body — so the server's scrubber, which
// runs on the Mac, is no longer the last line. BOARD.md's Movement C note calls for exactly
// this: "keeping push bodies scrubbed in the native layer the same way B4 already does on the
// web side." A payload that arrives from somewhere unexpected (a mis-scoped local notify, a
// future APNs path, a relay) gets the same treatment as one that went through pushNotify().
//
// The BY-REFERENCE half is deliberately NOT ported: it redacts the values of the server's
// own *_KEY/_TOKEN env vars, and the phone has no such environment. Shapes are the half that
// travels. Keep this list in sync with SHAPES in server/scrub.ts — the test next door pins
// that they agree on every example, so drift fails the suite rather than ageing quietly.

export const REDACTED = '[redacted]';

const SHAPES: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-or-[A-Za-z0-9_-]{16,}/g,
  /\bsk-proj-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgsk_[A-Za-z0-9]{20,}/g,
  /\bvcp_[A-Za-z0-9]{20,}/g,
  /\bcsk-[A-Za-z0-9]{20,}/g,
  /\bnvapi-[A-Za-z0-9_-]{20,}/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /\b[A-Fa-f0-9]{40,}\b/g, // long hex: session ids, sha-style secrets — incl. OUR OWN bearer token
];

/** Redact anything credential-shaped, keeping a short prefix so the line stays diagnosable. */
export function scrub(text: unknown): string {
  let s = typeof text === 'string' ? text : String(text ?? '');
  if (!s) return s;
  for (const re of SHAPES) {
    s = s.replace(re, (m) => {
      const keep = /^Bearer/i.test(m) ? 'Bearer ' : m.slice(0, Math.min(4, m.length));
      return `${keep}${REDACTED}`;
    });
  }
  return s;
}

/** Collapse an absolute home path to `~` — the phone's twin of collapseHomes(). A lock
 *  screen has no business naming the operator's account, and "/Users/romeo/…" does. */
export function collapseHomes(text: string): string {
  return String(text ?? '').replace(/\/(?:Users|home)\/[^/\s]+/g, '~');
}

/** What a notification body is allowed to say. Same contract as summarize()/pushNotify()
 *  server-side: scrubbed, home-collapsed, markdown stripped, hard length cap. */
export function safeBody(body: unknown, maxLen = 220): string {
  return collapseHomes(scrub(String(body ?? '').replace(/[#*`>]/g, ''))).slice(0, maxLen);
}
