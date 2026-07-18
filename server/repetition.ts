// Degenerate-repetition guard for model streams.
//
// Weak/quantized free brains and small local models sometimes fall into a repetition loop
// ("hello hello hello…", or a whole sentence repeated forever) and would otherwise stream
// garbage right up to the token cap. This is provider-agnostic — it inspects the text we've
// already accumulated, so it works for every brain (and even offline Ollama) with no
// cooperation from the provider.
//
// Deliberately conservative: real prose almost never repeats a short unit 6+ times back-to-back
// covering 40+ characters, and pure-symbol runs (table rules, "----") need an extreme count —
// so this won't trip on legitimate output.

const DEFAULTS = { minReps: 6, minCovered: 40, maxUnit: 80, symbolReps: 16, scan: 3000 };

/** Find a trailing unit repeated to a degenerate degree. Returns the run's start index and unit length, or null. */
function findTailLoop(text: string, o = DEFAULTS): { start: number; unitLen: number } | null {
  const n = text.length;
  const from = n > o.scan ? n - o.scan : 0;   // only scan the tail — that's where a live loop is
  const win = text.slice(from);
  const wn = win.length;
  if (wn < o.minCovered) return null;
  for (let L = 1; L <= o.maxUnit && L * o.minReps <= wn; L++) {
    const unit = win.slice(wn - L);
    let reps = 1, pos = wn - L;
    while (pos - L >= 0 && win.slice(pos - L, pos) === unit) { reps++; pos -= L; }
    if (reps < o.minReps || reps * L < o.minCovered) continue;
    const hasWord = /[a-z0-9]/i.test(unit);
    if (hasWord || reps >= o.symbolReps) return { start: from + pos, unitLen: L };
  }
  return null;
}

/** True when the tail of `text` is a short unit repeated so many times it's certainly a loop. */
export function isDegenerateRepetition(text: string): boolean {
  return findTailLoop(text) !== null;
}

/** Collapse a degenerate repeated tail down to a single occurrence (leaves normal text untouched). */
export function collapseRepetition(text: string): string {
  const hit = findTailLoop(text);
  if (!hit) return text;
  return text.slice(0, hit.start + hit.unitLen).replace(/\s+$/, "");
}
