// Deterministic chat-title cleanup and recency grouping for the sidebar chat list.
//
// Why deterministic: a raw `first.slice(0, 42)` reads badly ("👁️ (looking through t…").
// An LLM call per chat would title better but would spend free-tier quota — which SAM's
// doctrine treats as production infrastructure — so this is pure string work: zero cost,
// zero latency, no network, and testable.

// Leading decoration we drop before titling. Written as an ALTERNATION rather than a
// character class: a class cannot match a ZWJ-joined emoji sequence as one unit (that
// is what biome's noMisleadingCharacterClass flags). Deliberately excludes
// \p{Emoji_Component}, which would eat leading digits (e.g. a '2026 plan' title).
const LEADING_DECOR =
  /^(?:\p{Extended_Pictographic}|\uFE0F|\uFE0E|\u200D|[\u{1F3FB}-\u{1F3FF}]|\u20E3)+\s*/u;

/** A slash-command prefix, e.g. "/research " or "/note:". */
const SLASH_CMD = /^\/([a-z][\w-]*)[:\s]+/i;

/**
 * Turn the first user message into something scannable.
 *
 * - strips leading emoji / pictographs (they carry no ranking signal at 13px)
 * - lifts a leading slash-command into a readable prefix ("/research foo" → "Research: foo")
 * - flattens code fences, quotes and newlines to a single line
 * - truncates on a WORD boundary rather than mid-word
 */
export function cleanTitle(raw: string | undefined, max = 52): string {
  if (!raw) return "";
  // Collapse all whitespace (incl. newlines) and strip markdown noise that reads as garbage.
  let s = raw
    .replace(/```[\s\S]*?```/g, " ")   // fenced code blocks
    .replace(/`([^`]*)`/g, "$1")       // inline code
    .replace(/^[>#*\-\s]+/, "")        // blockquote / heading / bullet markers
    .replace(/\s+/g, " ")
    .trim();

  s = s.replace(LEADING_DECOR, "").trim();

  const cmd = s.match(SLASH_CMD);
  if (cmd) {
    const rest = s.slice(cmd[0].length).trim();
    const label = cmd[1].charAt(0).toUpperCase() + cmd[1].slice(1);
    s = rest ? `${label}: ${rest}` : label;
  } else if (/^\/[a-z][\w-]*$/i.test(s)) {
    // A bare slash-command with no argument.
    s = s.slice(1);
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Strip surrounding quotes left over after the above.
  s = s.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  if (!s) return "";

  // Sentence-case a lowercase opener so the list doesn't read like a log file.
  if (/^[a-z]/.test(s)) s = s.charAt(0).toUpperCase() + s.slice(1);

  if (s.length <= max) return s;

  // Word-boundary truncation: back off to the last space in the final 40% of the window,
  // so we never cut a word in half unless a single token is longer than the whole budget.
  const window = s.slice(0, max);
  const cut = window.lastIndexOf(" ");
  const body = cut > max * 0.6 ? window.slice(0, cut) : window;
  return body.replace(/[\s,;:.\-–—]+$/, "") + "…";
}

export type Bucket = "Today" | "Yesterday" | "Previous 7 days" | "Earlier";

/** Which recency bucket a timestamp falls into, relative to `now` (local calendar days). */
export function bucketOf(at: number, now: number = Date.now()): Bucket {
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOfDay(now);
  const day = 86400000;
  if (at >= today) return "Today";
  if (at >= today - day) return "Yesterday";
  if (at >= today - 7 * day) return "Previous 7 days";
  return "Earlier";
}

export const BUCKET_ORDER: Bucket[] = ["Today", "Yesterday", "Previous 7 days", "Earlier"];

/**
 * Group already-sorted items into recency buckets, preserving input order within each
 * bucket and dropping buckets that ended up empty (no empty headers in the list).
 */
export function groupByRecency<T extends { at: number }>(
  items: T[],
  now: number = Date.now(),
): { label: Bucket; items: T[] }[] {
  const out: { label: Bucket; items: T[] }[] = [];
  for (const label of BUCKET_ORDER) {
    const inBucket = items.filter((i) => bucketOf(i.at, now) === label);
    if (inBucket.length) out.push({ label, items: inBucket });
  }
  return out;
}

/** Case-insensitive substring match over a title plus any number of message bodies. */
export function matchesQuery(query: string, title: string, bodies: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (title.toLowerCase().includes(q)) return true;
  return bodies.some((b) => b.toLowerCase().includes(q));
}

/** The first message body containing `query`, trimmed to a short snippet around the hit. */
export function snippetFor(query: string, bodies: string[], span = 60): string {
  const q = query.trim().toLowerCase();
  if (!q) return "";
  for (const b of bodies) {
    const flat = b.replace(/\s+/g, " ").trim();
    const i = flat.toLowerCase().indexOf(q);
    if (i < 0) continue;
    const start = Math.max(0, i - Math.floor(span / 3));
    const end = Math.min(flat.length, start + span);
    return (start > 0 ? "…" : "") + flat.slice(start, end).trim() + (end < flat.length ? "…" : "");
  }
  return "";
}
