// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — knowing the whole project
//
//  `context.ts` answers "which files does this request implicate", and answers it well —
//  a scoped edit is why the yard stopped rewriting READMEs it was never asked about.
//  But scoping has a cost that only shows up as the project grows: the model is editing
//  blind to everything outside the scope. It adds a page that duplicates one already
//  there, imports a helper that does not exist, or writes a second stylesheet because it
//  never saw the first.
//
//  So: an index of EVERY file — cheap enough to send with every request, complete enough
//  that nothing is a surprise. The trick is that the summary is derived, never generated.
//  A model call per file would cost more than the edit it informs, and would be one more
//  thing that can be wrong. A heading, an export list, a title tag — these are already in
//  the file, and reading them is free and exact.
// ─────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".vercel"]);

// Bigger than context.ts's editable set on purpose: the index describes what EXISTS,
// including files an edit may not rewrite. Knowing a lockfile is there matters even
// though nothing should be hand-editing it.
const INDEXABLE = /\.(html?|css|scss|js|mjs|cjs|ts|tsx|jsx|json|md|txt|svg|ya?ml|toml)$/i;

export const MAX_INDEX_FILES = 400;
const READ_HEAD = 4_000;    // enough to find a heading or the first exports; never the whole file

export interface IndexedFile {
  path: string;
  bytes: number;
  summary: string;
}

// What one file is, in a few words, taken from the file itself.
export function summarise(path: string, head: string): string {
  const ext = (path.split(".").pop() || "").toLowerCase();

  if (ext === "html" || ext === "htm") {
    const title = head.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
    const h1 = head.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim();
    return [title && `title "${title}"`, h1 && `h1 "${h1.slice(0, 60)}"`].filter(Boolean).join(" · ") || "a page";
  }

  if (ext === "md") {
    const heading = head.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return heading ? `“${heading.slice(0, 70)}”` : "notes";
  }

  if (ext === "json") {
    // package.json is the one JSON worth reading properly — it says what the project IS.
    if (/(^|\/)package\.json$/.test(path)) {
      try {
        const p = JSON.parse(head.length < READ_HEAD ? head : "{}");
        const deps = Object.keys(p.dependencies ?? {});
        return [p.name && `package "${p.name}"`, deps.length ? `deps: ${deps.slice(0, 8).join(", ")}` : null]
          .filter(Boolean).join(" · ") || "package manifest";
      } catch { return "package manifest"; }
    }
    const keys = head.match(/"([A-Za-z0-9_-]+)"\s*:/g)?.slice(0, 6).map((k) => k.replace(/["':\s]/g, ""));
    return keys?.length ? `keys: ${keys.join(", ")}` : "data";
  }

  if (/^(css|scss)$/.test(ext)) {
    const selectors = head.match(/^\s*([.#][A-Za-z0-9_-]+)/gm)?.slice(0, 6).map((s) => s.trim());
    return selectors?.length ? `styles: ${[...new Set(selectors)].join(", ")}` : "styles";
  }

  if (/^(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) {
    const names = [...head.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/g)]
      .map((m) => m[1]).slice(0, 8);
    if (names.length) return `exports ${names.join(", ")}`;
    const comment = head.match(/^\s*\/\/\s*(.+)$/m)?.[1]?.trim();
    return comment ? comment.slice(0, 70) : "code";
  }

  const firstLine = head.split("\n").map((l) => l.trim()).find(Boolean);
  return firstLine ? firstLine.slice(0, 70) : "";
}

// Walk the project once. Directories that are build output or dependencies are skipped
// wholesale: indexing node_modules would be slower than the build and useful to nobody.
export function indexProject(dir: string, opts: { maxFiles?: number } = {}): IndexedFile[] {
  const max = opts.maxFiles ?? MAX_INDEX_FILES;
  const out: IndexedFile[] = [];

  const walk = (rel: string) => {
    if (out.length >= max) return;
    let entries: string[];
    try { entries = readdirSync(join(dir, rel)); } catch { return; }
    for (const e of entries.sort()) {
      if (out.length >= max) return;
      if (SKIP_DIRS.has(e) || e.startsWith(".")) continue;
      const r = rel ? join(rel, e) : e;
      let st: ReturnType<typeof statSync>;
      try { st = statSync(join(dir, r)); } catch { continue; }
      if (st.isDirectory()) { walk(r); continue; }
      if (!INDEXABLE.test(e)) { out.push({ path: r, bytes: st.size, summary: "" }); continue; }
      let head = "";
      try { head = readFileSync(join(dir, r), "utf8").slice(0, READ_HEAD); } catch { /* unreadable is still worth listing */ }
      out.push({ path: r, bytes: st.size, summary: summarise(r, head) });
    }
  };

  walk("");
  return out;
}

// The index as the model sees it. One line per file, so a hundred-file project costs a
// few hundred tokens rather than the whole tree's contents — the point is that nothing
// is a surprise, not that everything is readable.
export function renderIndex(files: IndexedFile[]): string {
  if (!files.length) return "(the project is empty)";
  return files
    .map((f) => `${f.path}${f.summary ? ` — ${f.summary}` : ""}`)
    .join("\n");
}
