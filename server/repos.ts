// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE REPO INDEX
//
//  SAM already knew which repos exist on GitHub (see the world) but had no idea
//  where — or whether — any of them live on THIS machine. So the git tools took a
//  raw `{dir}` the model had to invent, and inventing an absolute path goes wrong
//  in the obvious way: a path from the wrong operating system, or the literal
//  string "undefined". The index closes that gap. It walks a few likely roots for
//  working copies, reads each one's origin, and lets a tool resolve a plain NAME
//  ("mainline") to a real directory.
//
//  When it can't, it says so LOUDLY and usefully — naming what it looked for and
//  what it does know. A tool that quietly returns its own error text as if it were
//  output is worse than one that fails, because the model reads it as success and
//  then explains the imaginary result to the user.
// ─────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, existsSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

export interface Clone { path: string; owner: string | null; name: string | null; remote: string | null }

// Directory names that never contain a working copy worth indexing, and which are
// expensive or unwise to descend into.
const SKIP = new Set([
  "node_modules", "Library", "Applications", ".Trash", ".git", "dist", "build",
  "vendor", "venv", ".venv", "__pycache__", ".cache", "Music", "Movies", "Photos",
  "Pictures", ".npm", ".cargo", "go", "Public", "__MACOSX",
]);

// ── Remote parsing (pure) ───────────────────────────────────────────────────
// Handles the forms a working copy's origin actually takes; anything else yields
// null rather than a half-parsed guess.
export function parseRemote(url: string | null | undefined): { owner: string; name: string } | null {
  const u = String(url || "").trim();
  if (!u) return null;
  const strip = (s: string) => s.replace(/\.git$/i, "");
  let m = /^(?:https?:\/\/|git:\/\/)(?:[^@/]*@)?[^/]+\/([^/]+)\/([^/]+?)\/?$/i.exec(u);
  if (m) return { owner: m[1], name: strip(m[2]) };
  m = /^(?:ssh:\/\/)?(?:[^@]+@)([^:/]+)[:/]([^/]+)\/([^/]+?)\/?$/i.exec(u);
  if (m) return { owner: m[2], name: strip(m[3]) };
  return null;
}

// ── Discovery ───────────────────────────────────────────────────────────────
// A bounded walk: a handful of roots, shallow, skipping the noisy directories. This
// is deliberately not an exhaustive disk search — it finds the working copies a person
// actually keeps, in the places they keep them, without ever becoming slow.
export function scanRoots(): string[] {
  const home = os.homedir();
  const roots = [home, join(home, "Developer"), join(home, "Projects"), join(home, "Documents"), join(home, "Downloads"), join(home, "code")];
  // Mounted volumes too. Work does not only live in a home folder — an external drive is
  // where a lot of it actually sits, and a repo SAM cannot see is a repo SAM will insist
  // does not exist. The boot volume is skipped because it is just `/` again under another
  // name, and descending it twice would double every result.
  try {
    for (const name of readdirSync("/Volumes")) {
      const p = join("/Volumes", name);
      try {
        if (!statSync(p).isDirectory()) continue;
        if (realpathSync(p) === "/") continue;          // the boot volume, wearing its label
        roots.push(p);
      } catch { /* an ejecting or permission-denied volume is simply not searched */ }
    }
  } catch { /* no /Volumes on this platform */ }
  return roots.filter((p) => { try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; } });
}

// Read .git/config directly rather than shelling out: the walk touches many directories
// and spawning a process per candidate would make it slow enough to notice.
export function originFromConfig(text: string): string | null {
  const m = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/m.exec(String(text || ""));
  return m ? m[1] : null;
}
function originOf(dir: string): string | null {
  try { return originFromConfig(readFileSync(join(dir, ".git", "config"), "utf8")); } catch { return null; }
}

export function findClones(roots = scanRoots(), maxDepth = 2): Clone[] {
  const found: Clone[] = [];
  const seen = new Set<string>();
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || seen.has(dir)) return;
    seen.add(dir);
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    if (entries.includes(".git")) {
      const remote = originOf(dir);
      const parsed = parseRemote(remote);
      found.push({ path: dir, owner: parsed?.owner ?? null, name: parsed?.name ?? null, remote });
      // Deliberately keep walking. A working copy is not always a leaf: a folder that is
      // itself a clone can still hold other clones inside it (a Downloads folder that got
      // `git init`'d once will hide every project under it otherwise).
    }
    for (const e of entries) {
      if (e.startsWith(".") || SKIP.has(e)) continue;
      let sub: string;
      try { sub = join(dir, e); if (!statSync(sub).isDirectory()) continue; } catch { continue; }
      walk(sub, depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return found;
}

// ── Resolution (pure) ───────────────────────────────────────────────────────
// Separated from the filesystem so every branch is testable, including the ones
// that matter most: the empty/undefined input and the not-cloned-here case.

export type Resolved = { ok: true; path: string } | { ok: false; reason: string };

const looksLikePath = (s: string) => s.startsWith("/") || s.startsWith("~") || s.startsWith(".");

export function chooseRepo(
  input: unknown,
  clones: Clone[],
  remoteNames: string[] = [],
  exists: (p: string) => boolean = (p) => existsSync(join(p, ".git")),
): Resolved {
  const known = clones.length
    ? clones.map((c) => c.name || c.path.split("/").pop()).filter(Boolean).join(", ")
    : "(none found on this machine)";
  const raw = typeof input === "string" ? input.trim() : "";

  // The literal strings are not paranoia: they are what actually arrived when a
  // model filled the field with nothing.
  if (!raw || raw === "undefined" || raw === "null") {
    return { ok: false, reason: `no folder was given. Say which repo — SAM knows these working copies here: ${known}.` };
  }

  if (looksLikePath(raw)) {
    const p = raw.startsWith("~") ? join(os.homedir(), raw.slice(1)) : raw;
    if (exists(p)) return { ok: true, path: p };
    return { ok: false, reason: `"${p}" isn't a git working copy on this machine. Working copies here: ${known}.` };
  }

  // A bare name — the form a person actually uses ("commit in mainline").
  const want = raw.toLowerCase();
  const loose = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
  const matches = clones.filter((c) =>
    (c.name || "").toLowerCase() === want
    || c.path.split("/").pop()?.toLowerCase() === want
    || loose(c.name || "") === loose(want));

  // The same name in two places is normal once external drives are searched — a copy on
  // a working disk and a copy on a backup drive. Picking one silently is how the wrong
  // copy gets edited, and the wrong copy is often the one someone else is also using.
  // Refuse, and name both, so the choice is made on purpose.
  if (matches.length > 1) {
    return { ok: false, reason: `"${raw}" is ambiguous — there are ${matches.length} working copies with that name: ${matches.map((m) => m.path).join("  ·  ")}. Say which one by full path.` };
  }
  if (matches.length === 1) return { ok: true, path: matches[0].path };

  if (remoteNames.some((n) => n.toLowerCase() === want)) {
    return { ok: false, reason: `"${raw}" is one of your GitHub repos but it isn't cloned on this machine, so there's nothing local to work on. Clone it first, then ask again.` };
  }
  return { ok: false, reason: `no repo called "${raw}" here. Working copies on this machine: ${known}.` };
}

// ── Cached index + the throwing resolver the tools use ──────────────────────
let cache: { at: number; clones: Clone[] } | null = null;
const TTL = 5 * 60_000;

export function clones(force = false): Clone[] {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.clones;
  const c = findClones();
  cache = { at: Date.now(), clones: c };
  return c;
}
export function clearRepoCache() { cache = null; }

// Throws on failure BY DESIGN. The agent loop turns a thrown tool error into an
// honest "that didn't work (…)" the model can report; a returned error string would
// be read as a successful result and explained away.
export function resolveRepoDir(input: unknown, remoteNames: string[] = []): string {
  const r = chooseRepo(input, clones(), remoteNames);
  if (r.ok) return r.path;
  throw new Error(r.reason);
}

// What SAM knows locally, for the tool that reports it.
export function repoIndex(): { path: string; name: string; remote: string | null }[] {
  return clones().map((c) => ({ path: c.path, name: c.name || c.path.split("/").pop() || c.path, remote: c.remote }));
}
