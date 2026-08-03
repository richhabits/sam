// QUICK ACTIONS — the link a Home or Lock Screen widget taps.
//
// The widget (widget/SAMWidget.swift) is a launcher and nothing else: it has no pairing token,
// no reach to the Mac, and no business inventing a second way to talk to SAM. So it opens a URL,
// and this is the contract for that URL:
//
//   sam://ask               — open the agent surface, ready to type
//   sam://ask?text=<prompt> — open the agent surface and send that prompt
//   sam://tasks             — open the tasks surface
//
// Nothing here is widget-specific. The same links work from Shortcuts, a QR code, a Handoff, or
// another app — a widget is just the first caller.
//
// Strict on purpose, like parsePairLink: the text goes on to be SENT to SAM as if the operator
// typed it, so an over-permissive parser here would let any link on the internet put words in
// their mouth. Only our own scheme is accepted (an https link cannot reach this), only two
// actions exist, and the prompt is bounded and stripped of control characters.

import { param } from './url';

export type QuickAction = 'ask' | 'tasks';
export type QuickLink = { action: QuickAction; text: string | null };

// Long enough for a real instruction, short enough that a crafted link cannot paste an essay
// into the conversation. The composer has no limit; a link is not the composer.
const MAX_TEXT = 500;

/**
 * Extract a quick action from a URL. Returns null for anything that isn't one — including
 * pairing links, http(s) links, and unknown actions.
 */
export function parseQuickLink(url: string | null | undefined): QuickLink | null {
  const raw = String(url || '').trim();
  if (!raw) return null;

  const q = raw.indexOf('?');
  const before = q === -1 ? raw : raw.slice(0, q);
  const query = q === -1 ? '' : raw.slice(q + 1);

  const m = before.match(/^sam:\/\/(ask|tasks)\/?$/i);
  if (!m) return null;
  const action = m[1].toLowerCase() as QuickAction;

  // Only `ask` carries a prompt. A `text` on `sam://tasks` is a malformed link, not an
  // instruction — reading it anyway is how a parser starts honouring things it never agreed to.
  if (action !== 'ask') return { action, text: null };

  const text = param(query, 'text')
    // Newlines and control characters would let a link forge what looks like several turns, or
    // hide the real instruction below the fold of the composer. Written as \u escapes rather
    // than the literal bytes, which are INVISIBLE in an editor and in `cat` — the class read as
    // `[ -]`, a real and plausible range (space to hyphen) that would silently eat commas and
    // apostrophes from every prompt. Git even classified the file as BINARY because of them.
    // Written as \u escapes rather than literal bytes: the literals are invisible in an editor
    // and in `cat` — the class read as `[ -]`, a plausible space-to-hyphen range that would have
    // eaten commas and apostrophes from every prompt — and git classified the file as BINARY
    // with them in.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters IS the point here.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT)
    .trim();

  return { action, text: text || null };
}
