// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — choosing what an edit gets to see
//
//  Two problems solved in one place, because they are the same problem.
//
//  A project bigger than the context window used to have its files quietly cut short.
//  That is worse than it sounds: an edit returns WHOLE files, so a model shown the
//  first part of a file writes back only the first part — the rest is deleted, and it
//  looks like a successful edit. Nothing is ever truncated now. A file that will not
//  fit whole is not offered at all, and the job says which ones it left out.
//
//  And the model should only be able to change what the request is actually about.
//  Handed the whole project, it reasonably tidies things nobody asked about; the first
//  drive rewrote a README while changing a heading. So the context is SCOPED to the
//  files the request implicates, and that same set is the only thing writable (plus
//  genuinely new files, which are how a project grows).
// ─────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const EDITABLE = /\.(html?|css|js|mjs|ts|tsx|jsx|json|md|txt|svg)$/i;
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);

export const MAX_FILES = 12;
export const MAX_BYTES = 60_000;
export const MAX_ONE_FILE = 24_000;   // one file may not eat the whole context

export interface ProjectFile { path: string; content: string; bytes: number }

// Every editable file, whole. Nothing is cut short here; the decision about what will
// fit is made afterwards, where it can be reported.
export function readEditable(dir: string, protectedPaths: Set<string> = new Set()): ProjectFile[] {
  const out: ProjectFile[] = [];
  const walk = (rel: string) => {
    let entries: string[];
    try { entries = readdirSync(join(dir, rel)); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e) || e.startsWith(".")) continue;
      const r = rel ? join(rel, e) : e;
      if (protectedPaths.has(r)) continue;
      let isDir = false;
      try { isDir = statSync(join(dir, r)).isDirectory(); } catch { continue; }
      if (isDir) { walk(r); continue; }
      if (!EDITABLE.test(e)) continue;
      try {
        const content = readFileSync(join(dir, r), "utf8");
        out.push({ path: r, content, bytes: Buffer.byteLength(content) });
      } catch { /* unreadable — simply not a candidate */ }
    }
  };
  walk("");
  return out;
}

// Words in the request worth matching on. Common words carry no signal and would make
// everything look equally relevant, which is the same as having no scoring at all.
const NOISE = new Set([
  "the", "a", "an", "to", "on", "in", "of", "and", "or", "for", "with", "please", "can",
  "you", "make", "change", "update", "edit", "add", "set", "put", "it", "its", "this",
  "that", "my", "me", "i", "is", "be", "into", "from", "at", "as", "so", "then", "new",
]);

export function keywords(request: string): string[] {
  return String(request || "").toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !NOISE.has(w));
}

// How much a file looks like what the request is about. Deliberately simple and
// readable: named outright beats mentioned inside, which beats being the obvious
// starting point of a web project.
export function score(file: ProjectFile, request: string, words = keywords(request)): number {
  const lowerPath = file.path.toLowerCase();
  const stem = lowerPath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  const lowerText = file.content.toLowerCase();
  let s = 0;

  if (request.toLowerCase().includes(lowerPath)) s += 20;          // named exactly
  else if (stem.length > 2 && request.toLowerCase().includes(stem)) s += 12;

  for (const w of words) {
    if (lowerPath.includes(w)) s += 4;
    if (lowerText.includes(w)) s += 2;
  }

  // The page a web project starts from is nearly always the thing meant when someone
  // says "the site", so it gets a nudge rather than relying on a word matching.
  if (/^index\.(html?|jsx?|tsx?)$/.test(lowerPath)) s += 5;

  return s;
}

// Documentation describes the project, so it repeats the project's own words — which
// makes it score well on almost any request about that project, and it was duly rewritten
// while a heading was being changed. Scoring cannot fix that: the README is genuinely
// "about" the request. So it is a RULE instead. Docs are only in scope when the request
// asks for them by name.
export function isDocumentation(path: string): boolean {
  return /(^|\/)(readme|licen[cs]e|changelog|contributing)(\.[^/]*)?$/i.test(path);
}
export function asksForDocs(request: string): boolean {
  return /\b(readme|docs?|documentation|changelog|licen[cs]e|contributing)\b/i.test(String(request || ""));
}

export interface Selection {
  offered: ProjectFile[];
  tooBig: string[];        // would not fit whole — deliberately NOT truncated
  leftOut: string[];       // fit, but less relevant than what was chosen
}

// Choose the files an edit may see, best first, never cutting one short.
export function selectContext(files: ProjectFile[], request: string, opts: { maxFiles?: number; maxBytes?: number; maxOne?: number } = {}): Selection {
  const maxFiles = opts.maxFiles ?? MAX_FILES;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const maxOne = opts.maxOne ?? MAX_ONE_FILE;

  const words = keywords(request);
  const docsWanted = asksForDocs(request);
  const tooBig = files.filter((f) => f.bytes > maxOne).map((f) => f.path);
  // Excluded, but NOT silently: a file the edit cannot reach must be reported, or you
  // are left wondering why the change you asked for did not appear there.
  const docsHeldBack = docsWanted ? [] : files.filter((f) => isDocumentation(f.path)).map((f) => f.path);
  const ranked = files
    .filter((f) => f.bytes <= maxOne)
    .filter((f) => docsWanted || !isDocumentation(f.path))
    .map((f) => ({ f, s: score(f, request, words) }))
    .sort((a, b) => b.s - a.s || a.f.path.localeCompare(b.f.path));

  // Fitting is not the same as being relevant. A small project's files ALL fit, and
  // offering them all is how an edit ends up rewriting things nobody asked about. Only
  // files the request actually touches are shown — except that the best candidate is
  // always kept, so a vague request still gets somewhere to start rather than nothing.
  const relevant = ranked.filter((r) => r.s > 0);
  const shortlist = relevant.length ? relevant : ranked.slice(0, 1);

  const offered: ProjectFile[] = [];
  const leftOut: string[] = [];
  let budget = maxBytes;
  for (const { f } of shortlist) {
    if (offered.length < maxFiles && f.bytes <= budget) { offered.push(f); budget -= f.bytes; }
    else leftOut.push(f.path);
  }
  // Everything the request did not implicate is reported too — an edit that cannot reach
  // a file should say so, not leave you wondering why it was ignored.
  for (const { f } of ranked) if (!offered.includes(f) && !leftOut.includes(f.path)) leftOut.push(f.path);
  for (const p of docsHeldBack) if (!leftOut.includes(p)) leftOut.push(p);
  return { offered, tooBig, leftOut };
}

// What an edit is allowed to write back. Only what it was shown, or something genuinely
// new — a model cannot change a file it never saw, and a file it saw but was not asked
// about is exactly the thing it rewrites unprompted.
export function admissible(
  proposed: { path: string; content: string }[],
  offered: ProjectFile[],
  existing: ProjectFile[] = offered,
  protectedPaths: Set<string> = new Set(),
): { write: { path: string; content: string }[]; refused: { path: string; why: string }[] } {
  const shown = new Map(offered.map((f) => [f.path, f.content]));
  const onDisk = new Set(existing.map((f) => f.path));
  const write: { path: string; content: string }[] = [];
  const refused: { path: string; why: string }[] = [];

  for (const p of proposed) {
    const path = String(p.path).replace(/^\.\//, "");
    if (protectedPaths.has(path)) { refused.push({ path, why: "SAM's own record of the project is not editable this way" }); continue; }
    if (!EDITABLE.test(path)) { refused.push({ path, why: "not a kind of file the yard edits" }); continue; }

    if (shown.has(path)) {
      // Returning a file byte-for-byte unchanged is not an edit; writing it would make
      // the checkpoint claim a change that did not happen.
      if (shown.get(path) === p.content) { refused.push({ path, why: "unchanged" }); continue; }
      write.push({ path, content: p.content });
      continue;
    }

    // Not shown. A genuinely NEW file is how a project grows, so that is allowed. A file
    // that EXISTS but was not part of this request is refused — rewriting it blind would
    // replace contents the model never saw, and it is exactly the unprompted tidying that
    // made an edit rewrite a README nobody mentioned.
    if (onDisk.has(path)) refused.push({ path, why: "it exists but this request did not implicate it — it was not read, so it will not be overwritten" });
    else write.push({ path, content: p.content });
  }
  return { write, refused };
}
