// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — what actually changed
//
//  The build loop writes files on its own. Auto-applying is the right default — asking
//  permission for every line is what makes a builder tiring to use — but auto-applying
//  without a record is how a project drifts somewhere nobody chose. So every write
//  leaves a diff behind: applied, inspectable afterwards, and revertible because the
//  bytes that were there before are kept.
//
//  Written here rather than pulled in, because the requirement is small and exact: a
//  line-level diff over text files that is readable by a person and cheap to produce.
//  A dependency for this would be more surface than the thing it does.
//
//  The algorithm is the standard longest-common-subsequence walk. It is quadratic in
//  the number of lines, which is why `diffFiles` refuses anything past a ceiling rather
//  than quietly taking a second on a large file: a diff nobody can read is not worth
//  the wait to produce it.
// ─────────────────────────────────────────────────────────────

export type ChangeKind = "added" | "removed" | "modified";

export interface Hunk { at: number; removed: string[]; added: string[] }

export interface FileDiff {
  path: string;
  kind: ChangeKind;
  hunks: Hunk[];
  addedLines: number;
  removedLines: number;
  before: string | null;      // kept so a diff can be undone, not merely displayed
  truncated: boolean;         // too large to diff line-by-line; counts only
}

// Past this a diff stops being something a person reads and starts being a wait.
export const MAX_DIFF_LINES = 4_000;

const lines = (s: string): string[] => (s === "" ? [] : s.split("\n"));

// Longest common subsequence table over two line arrays. Only the lengths are stored;
// the walk back out reads the table rather than keeping paths, so memory stays O(n·m)
// integers instead of O(n·m) arrays.
function lcs(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

// Walk the table into runs of removed/added lines. Consecutive changes are collected
// into one hunk, because a person reads "these three lines became those two", not six
// separate single-line facts.
export function hunksBetween(beforeText: string, afterText: string): Hunk[] {
  const a = lines(beforeText);
  const b = lines(afterText);
  const table = lcs(a, b);

  const out: Hunk[] = [];
  let current: Hunk | null = null;
  let i = 0;
  let j = 0;

  const flush = () => { if (current) { out.push(current); current = null; } };
  const open = () => { if (!current) current = { at: i, removed: [], added: [] }; return current; };

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { flush(); i++; j++; continue; }
    if (table[i + 1][j] >= table[i][j + 1]) { open().removed.push(a[i]); i++; }
    else { open().added.push(b[j]); j++; }
  }
  while (i < a.length) { open().removed.push(a[i]); i++; }
  while (j < b.length) { open().added.push(b[j]); j++; }
  flush();
  return out;
}

// The diff for one file. `before` is null for a file that did not exist, which is what
// makes "added" different from "modified from empty" — the distinction matters when the
// diff is later used to undo.
export function diffFiles(path: string, before: string | null, after: string): FileDiff {
  const kind: ChangeKind = before === null ? "added" : after === "" ? "removed" : "modified";
  const beforeText = before ?? "";
  const tooBig = lines(beforeText).length + lines(after).length > MAX_DIFF_LINES;

  if (tooBig) {
    return {
      path, kind, hunks: [], before,
      addedLines: lines(after).length,
      removedLines: lines(beforeText).length,
      truncated: true,
    };
  }

  const hunks = hunksBetween(beforeText, after);
  return {
    path, kind, hunks, before,
    addedLines: hunks.reduce((n, h) => n + h.added.length, 0),
    removedLines: hunks.reduce((n, h) => n + h.removed.length, 0),
    truncated: false,
  };
}

// One line per file, for a log or a job result. The shape a person scans to see whether
// a build did roughly what they expected before opening anything.
export function summariseDiff(d: FileDiff): string {
  if (d.truncated) return `${d.path} — ${d.kind}, too large to diff (${d.addedLines} lines now)`;
  if (d.kind === "added") return `${d.path} — new, ${d.addedLines} line${d.addedLines === 1 ? "" : "s"}`;
  if (d.kind === "removed") return `${d.path} — emptied`;
  return `${d.path} — +${d.addedLines} −${d.removedLines}`;
}

export function summariseAll(diffs: FileDiff[]): string {
  if (!diffs.length) return "nothing changed";
  const added = diffs.reduce((n, d) => n + d.addedLines, 0);
  const removed = diffs.reduce((n, d) => n + d.removedLines, 0);
  return `${diffs.length} file${diffs.length === 1 ? "" : "s"} · +${added} −${removed}`;
}

// Unified-diff text, for the surfaces that want to render one. Deliberately not the
// full unified format with context lines: this is what changed, not a patch to feed
// back into a tool, and the honest smaller thing is easier to trust.
export function renderDiff(d: FileDiff): string {
  const head = `--- ${d.path}`;
  if (d.truncated) return `${head}\n(too large to show — ${d.addedLines} lines)`;
  const body = d.hunks.flatMap((h) => [
    `@@ line ${h.at + 1} @@`,
    ...h.removed.map((l) => `- ${l}`),
    ...h.added.map((l) => `+ ${l}`),
  ]);
  return [head, ...body].join("\n");
}
