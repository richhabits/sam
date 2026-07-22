// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — pinpoint edits
//
//  The other way to change a file. A whole-file rewrite makes the model reproduce every
//  byte it is NOT changing, which costs tokens in proportion to the file (not the change)
//  and carries the failure this yard fears most: a model shown half a file writes back half
//  a file, and the rest is silently deleted. A large file cannot be edited that way at all.
//
//  A pinpoint edit names an EXACT passage to replace. The safety is in the exactness: a
//  `find` is applied only when it appears EXACTLY ONCE. Zero matches or several are refused,
//  never guessed — so an edit can only ever change the one span it named, and can never quietly
//  eat the rest of the file. The change that travels is the size of the change, not the file.
// ─────────────────────────────────────────────────────────────

export interface Edit { find: string; replace: string }
export interface EditFailure { index: number; find: string; why: string }
export interface EditOutcome { ok: boolean; content: string; applied: number; failures: EditFailure[] }

// How many times `needle` occurs in `hay`, as plain non-overlapping substrings.
function occurrences(hay: string, needle: string): number {
  return needle ? hay.split(needle).length - 1 : Infinity;
}

/**
 * Apply pinpoint edits to a file's text, in order, each against the running result.
 *
 * All-or-nothing is the caller's to enforce via `ok`: this returns the fully-applied text AND
 * the list of anything that could not be placed, so the caller can choose to write the result
 * only when nothing was refused (the safe default) and leave the file untouched otherwise.
 *
 * A block is refused — not guessed — when its `find` is empty, missing, or ambiguous (more than
 * one match). Replacement is literal: `$` in the replacement has no special meaning (unlike
 * String.replace with a string), so replacing with code full of `$` does exactly what it says.
 */
export function applyEdits(content: string, edits: Edit[]): EditOutcome {
  let current = content;
  let applied = 0;
  const failures: EditFailure[] = [];

  edits.forEach((e, index) => {
    const find = typeof e?.find === "string" ? e.find : "";
    const replace = typeof e?.replace === "string" ? e.replace : "";
    if (!find) { failures.push({ index, find, why: "empty target — a pinpoint edit must name the passage to change" }); return; }
    const n = occurrences(current, find);
    if (n === 0) { failures.push({ index, find, why: "not found — the passage to change is not in the file (it may already be edited)" }); return; }
    if (n > 1) { failures.push({ index, find, why: `matches ${n} places — too ambiguous to apply safely; name a longer, unique passage` }); return; }
    current = current.replace(find, () => replace);   // function replacer ⇒ literal, no $ interpretation
    applied += 1;
  });

  return { ok: failures.length === 0, content: current, applied, failures };
}
