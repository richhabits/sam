// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — looking at what was built
//
//  A project you cannot see is a project you cannot judge. The yard could build, commit
//  and even deploy, while SAM had no way to show you a single page it had made.
//
//  Serving files is the part of that worth being careful about, because "serve a file
//  from a path in the URL" is the oldest way to hand over a machine. So the same rule
//  used everywhere else in the yard applies here: resolve the path to what it REALLY is,
//  then check it is inside the project — never compare the strings someone sent.
// ─────────────────────────────────────────────────────────────

import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import { join, extname, sep } from "node:path";
import { projectsRoot, projectPath, isManagedProject } from "./managed.ts";
import { trueLocation, isWithin } from "./exec.ts";

// Only what a built page legitimately needs. Anything else is not served rather than
// guessed at — an unknown type handed back as octet-stream is still a file handed back.
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

export type Served = { ok: true; path: string; type: string } | { ok: false; status: number; reason: string };

// Work out what to serve for a request, or refuse. Pure apart from asking the filesystem
// what exists, so every refusal can be tested without a server.
export function resolvePreview(slug: string, rel: string): Served {
  if (!isManagedProject(slug)) return { ok: false, status: 404, reason: "no such project" };

  const root = projectPath(slug);
  // A request for the project root means its front page.
  const wanted = !rel || rel === "/" ? "index.html" : rel.replace(/^\/+/, "");

  // Refused before resolution as well as after: a request carrying a traversal is a
  // signal in itself, and there is no legitimate reason for one.
  if (wanted.includes("..") || wanted.startsWith("/") || wanted.includes("\0")) {
    return { ok: false, status: 403, reason: "that path is not allowed" };
  }

  const target = trueLocation(join(root, wanted));
  if (!isWithin(root, target)) return { ok: false, status: 403, reason: "that path is outside the project" };
  // The repository's own machinery is not part of the site, and its contents are history
  // rather than content — serving it would hand over every version of every file.
  if (/(^|\/)\.git(\/|$)/.test(target.slice(root.length))) return { ok: false, status: 403, reason: "not part of the site" };

  if (!existsSync(target)) return { ok: false, status: 404, reason: "no such file in this project" };
  let st: import("node:fs").Stats;
  try { st = statSync(target); } catch { return { ok: false, status: 404, reason: "no such file in this project" }; }

  if (st.isDirectory()) {
    const index = join(target, "index.html");
    if (!existsSync(index)) return { ok: false, status: 404, reason: "that folder has no index.html" };
    return { ok: true, path: index, type: TYPES[".html"] };
  }

  const type = TYPES[extname(target).toLowerCase()];
  if (!type) return { ok: false, status: 415, reason: "the preview does not serve that kind of file" };
  return { ok: true, path: target, type };
}

export interface FileEntry { path: string; bytes: number }

// The file list the builder view shows. Bounded, because a project with a node_modules
// in it would otherwise produce a listing nobody can read.
export function projectFiles(slug: string, limit = 200): FileEntry[] {
  if (!isManagedProject(slug)) return [];
  const root = projectPath(slug);
  const out: FileEntry[] = [];
  const walk = (rel: string, depth: number) => {
    if (out.length >= limit || depth > 6) return;
    let entries: string[];
    try { entries = readdirSync(join(root, rel)); } catch { return; }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e === ".git" || e === "node_modules" || e === ".DS_Store") continue;
      const r = rel ? join(rel, e) : e;
      try {
        const st = statSync(join(root, r));
        if (st.isDirectory()) walk(r, depth + 1);
        else out.push({ path: r.split(sep).join("/"), bytes: st.size });   // web paths are always forward-slash, even on Windows
      } catch { /* vanished mid-walk — simply not listed */ }
    }
  };
  walk("", 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function readProjectFile(slug: string, rel: string, maxBytes = 200_000): string | null {
  const r = resolvePreview(slug, rel);
  if (!r.ok) return null;
  try { return readFileSync(r.path, "utf8").slice(0, maxBytes); } catch { return null; }
}

export { projectsRoot };
