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
import { generatePremiumDesignSystem } from "../antigravity-brain.ts";

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

  let root = projectPath(slug);
  // A project with a real build step (Vite, etc.) ships an index.html that references unbuilt
  // source — <script src="/src/main.jsx"> — which this server correctly refuses rather than
  // serving broken (wrong extension, and raw JSX isn't valid browser JS regardless). If a build
  // has actually been run, dist/ is the real, viewable, deployable artifact: prefer it for the
  // WHOLE project, not just the front page, since its own assets are referenced relative to
  // itself. A project with no dist/ (a plain static site, the common case) is unaffected — this
  // only ever changes behaviour when a real build output exists to show instead.
  const distRoot = join(root, "dist");
  if (existsSync(join(distRoot, "index.html"))) root = distRoot;
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
      // "/" always — see the note in tree.ts. These become URL segments in the preview and the
      // Files tab, and a backslash is not a path separator in a URL.
      const r = rel ? `${rel}/${e}` : e;
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

// isManagedProject() does no format validation — an unmanaged slug can be literally anything
// the caller sent, including "<script>...". It only ever reaches the filesystem as a joined
// path segment (safe), but here it goes straight into an HTML string, so it needs its own escape.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders an instant 100x ultra-premium glassmorphic HTML preview for any Yard project.
 */
export function renderProjectPreviewHtml(
  slug: string,
  theme: "obsidian" | "midnight-slate" | "cyberpunk" | "luxury-gold" = "obsidian"
): string {
  if (!isManagedProject(slug)) {
    return `<div style="font-family:sans-serif;padding:40px;text-align:center;"><h2>Project "${escapeHtml(slug)}" not found in The Yard.</h2></div>`;
  }
  const root = projectPath(slug);
  const index = join(root, "index.html");
  if (existsSync(index)) {
    try {
      return readFileSync(index, "utf8");
    } catch {
      // fallback
    }
  }

  const files = projectFiles(slug);
  const ds = generatePremiumDesignSystem({ brandName: slug.toUpperCase(), theme });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${escapeHtml(slug)} · S.A.M. Yard Live Preview</title>
  <style>
${ds.glassmorphismCss}
  </style>
</head>
<body>
  <div style="max-width: 1000px; margin: 0 auto; padding: 40px 20px;">
    ${ds.heroComponentHtml}
    <div style="margin-top: 40px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
      ${ds.cardComponentHtml}
      <div class="glass-card" style="padding: 32px;">
        <div style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--secondary-accent); margin-bottom: 12px;">PROJECT ASSETS</div>
        <div style="font-size: 1.5rem; font-weight: 700; color: #FFFFFF; margin-bottom: 12px;">${files.length} Files Indexed</div>
        <p style="color: var(--text-sub); font-size: 0.95rem; line-height: 1.5; margin: 0 0 16px 0;">
          The Yard is actively compiling and staging your project structure in real time.
        </p>
        <div style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--primary-accent); max-height: 120px; overflow-y: auto;">
          ${files.slice(0, 10).map((f) => `<div>📄 ${escapeHtml(f.path)} (${(f.bytes / 1024).toFixed(1)} KB)</div>`).join("")}
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export { projectsRoot };

