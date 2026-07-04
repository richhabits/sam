// ─────────────────────────────────────────────────────────────
//  S.A.M. · LIVE CONTEXT  — SAM always knows the date/time and
//  roughly where Romeo is (so "today", "tonight", "near me",
//  "the weather" all just work). Date/time is exact; location is
//  free IP-based (approximate), overridable via SAM_LOCATION.
// ─────────────────────────────────────────────────────────────

let LOC = "";        // cached location string
let locAt = 0;

// Exact current date + time, human-readable, with timezone.
export function nowText(): string {
  const d = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const s = d.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `${s} (${tz})`;
}

// Fetch approximate location from IP (free, no key). Cached ~6h.
export async function fetchLocation(force = false): Promise<string> {
  if (process.env.SAM_LOCATION) return process.env.SAM_LOCATION;   // manual override wins
  if (LOC && !force && Date.now() - locAt < 6 * 3600_000) return LOC;
  try {
    const r = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(5000) });
    const d: any = await r.json();
    if (d && d.success !== false && d.city) {
      LOC = [d.city, d.region, d.country].filter(Boolean).join(", ");
      locAt = Date.now();
    }
  } catch { /* offline / blocked — SAM works without it */ }
  return LOC;
}

// Sync read for the system prompt (uses the cached value).
export function locationText(): string { return process.env.SAM_LOCATION || LOC; }

// Warm the cache at boot.
export function initContext() { void fetchLocation(); }
