// Pairing by link instead of by typing.
//
// SAM's codes are 32 hex characters. Typing one into a phone is a genuinely bad experience and
// an error-prone one — and the browser flow never asks anyone to: the Mac prints
// http://<host>/pair?code=… and you click it. This is the app's equivalent, so the phone can be
// paired the same way (a tapped link, a scanned QR, a handoff), with typing kept only as the
// fallback for when the phone can't reach the Mac's screen.
//
// Two URL shapes are accepted deliberately:
//
//   sam://pair?code=<code>&host=<url>   — our own scheme, what a QR/handoff link carries
//   http://<host>:<port>/pair?code=…    — the EXACT link the server already mints for browsers,
//                                         so pasting that into the app just works, and the host
//                                         is implied by the link itself rather than retyped.
//
// Parsing is deliberately strict about the code (hex only, bounded length): this value goes
// straight into a pairing exchange, and a permissive parser here would let a malformed or
// crafted link put arbitrary text on the wire.

export type PairLink = { code: string; host: string | null };

const CODE_RE = /^[a-f0-9]{16,64}$/i;

/** Pull a query parameter without depending on a full URL parser being present/consistent
 *  across RN engines. Returns "" when absent. */
function param(query: string, name: string): string {
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (decodeURIComponent(pair.slice(0, eq)) !== name) continue;
    try {
      return decodeURIComponent(pair.slice(eq + 1));
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Extract a pairing code (and, when the link carries one, the SAM to send it to) from a URL.
 * Returns null for anything that isn't a well-formed pairing link — including a link whose
 * "code" isn't code-shaped.
 */
export function parsePairLink(url: string | null | undefined): PairLink | null {
  const raw = String(url || '').trim();
  if (!raw) return null;

  const q = raw.indexOf('?');
  if (q === -1) return null;
  const before = raw.slice(0, q);
  const query = raw.slice(q + 1);

  // Must actually be a *pairing* link — not just any URL that happens to carry a code param.
  if (!/(^sam:\/\/pair$)|(^sam:\/\/pair\/$)|(\/pair$)|(\/pair\/$)/i.test(before)) return null;

  const code = param(query, 'code');
  if (!CODE_RE.test(code)) return null;

  // An http(s) link names the SAM it came from — that's the address to talk to, so the user
  // never types it. Our own scheme can carry one explicitly instead.
  let host: string | null = null;
  const httpMatch = before.match(/^(https?:\/\/[^/]+)\/pair\/?$/i);
  if (httpMatch) host = httpMatch[1];
  else {
    const explicit = param(query, 'host');
    if (/^https?:\/\/[^/\s]+$/i.test(explicit)) host = explicit.replace(/\/+$/, '');
  }

  return { code, host };
}
