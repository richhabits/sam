// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — managed projects
//
//  Everything the yard builds lives under its own root, never inside SAM's source.
//  Each project is a real git repository from the moment it is created, because the
//  cheapest possible undo is one that already exists: after every completed piece of
//  work the yard commits, and going back is a checkout rather than an apology.
//
//  Alongside the code sits `project.sam.json` — what this project is FOR. A build that
//  spans sessions has to survive the end of one, and a directory of files cannot say
//  what it was trying to be. The manifest carries the intent, the decisions taken, the
//  work outstanding and the problems known, so the next session opens knowing all of it.
//
//  Git is driven through the confined executor, not a shell, so project management is
//  bound by the same rules as everything else the yard runs — including the Handshake.
//  A failed git operation FAILS the operation loudly; the whole reason the executor
//  throws is that a silent git error once had SAM explaining an outcome that never was.
// ─────────────────────────────────────────────────────────────

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { execInProject } from "./exec.ts";

export function yardRoot(): string {
  return process.env.SAMYARD_DIR || join(os.homedir(), "SAMYard");
}
export function projectsRoot(): string { return join(yardRoot(), "projects"); }
export function projectPath(slug: string): string { return join(projectsRoot(), slug); }

export const MANIFEST = "project.sam.json";

export interface Manifest {
  slug: string;
  name: string;
  spec: string;                                    // what it is meant to be, in words
  decisions: { at: number; note: string }[];       // choices taken, so they are not re-litigated
  todo: { done: boolean; note: string }[];
  issues: string[];                                // known problems, stated rather than forgotten
  createdAt: number;
  updatedAt: number;
}

// A slug becomes a directory name, so it is built rather than accepted: anything that
// could climb out of the projects root simply cannot survive this.
export function slugify(name: string): string {
  const s = String(name ?? "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "project";
}

// Two projects called "hello site" are a normal thing to want. The second becomes
// hello-site-2 rather than quietly opening the first — which would look like success
// while writing into someone else's work.
export function uniqueSlug(name: string, taken: (slug: string) => boolean = (s) => existsSync(projectPath(s))): string {
  const base = slugify(name);
  if (!taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!taken(candidate)) return candidate;
  }
  throw new Error(`the yard: too many projects already called "${base}"`);
}

export function readManifest(slug: string): Manifest | null {
  try { return JSON.parse(readFileSync(join(projectPath(slug), MANIFEST), "utf8")) as Manifest; }
  catch { return null; }
}

export function writeManifest(slug: string, m: Manifest): void {
  m.updatedAt = Date.now();
  writeFileSync(join(projectPath(slug), MANIFEST), `${JSON.stringify(m, null, 2)}\n`);
}

// Update the manifest in place. Deliberately a read-modify-write of the file on disk
// rather than a cached object: the worker and the server are different processes, and
// the file is the only thing they both agree on.
export function updateManifest(slug: string, patch: Partial<Manifest>): Manifest {
  const current = readManifest(slug);
  if (!current) throw new Error(`the yard: ${slug} has no ${MANIFEST} — it is not a managed project`);
  const next: Manifest = { ...current, ...patch, slug: current.slug, createdAt: current.createdAt };
  writeManifest(slug, next);
  return next;
}

const DEFAULT_IGNORE = ["node_modules/", "dist/", ".env", ".DS_Store", ""].join("\n");

export interface CreateOptions { spec?: string; handshake?: boolean; now?: number }

// Create a project and put it under version control immediately, so there is a
// checkpoint to return to before anything has had a chance to go wrong.
export async function createProject(name: string, opts: CreateOptions = {}): Promise<Manifest> {
  const slug = uniqueSlug(name);
  const dir = projectPath(slug);
  mkdirSync(dir, { recursive: true });

  // node_modules is ignored from the outset, which also means restoring a checkpoint
  // never deletes the installed dependencies (git clean leaves ignored files alone).
  writeFileSync(join(dir, ".gitignore"), DEFAULT_IGNORE);

  const now = opts.now ?? Date.now();
  const manifest: Manifest = {
    slug, name: String(name), spec: opts.spec ?? "",
    decisions: [], todo: [], issues: [], createdAt: now, updatedAt: now,
  };
  writeManifest(slug, manifest);

  const git = (args: string[]) => execInProject(dir, "git", args, { handshake: opts.handshake });
  // -b main so the branch name is decided here rather than by whatever git is installed.
  await git(["init", "-b", "main"]);
  // Identity is set PER REPOSITORY: the child's HOME is the project, so a global git
  // config is invisible to it, and a commit with no identity fails outright.
  await git(["config", "user.name", "SAM"]);
  await git(["config", "user.email", "sam@localhost"]);
  await git(["add", "-A"]);
  const first = await git(["commit", "-m", `Start ${slug}`]);
  if (first.code !== 0) throw new Error(`the yard: could not make the first checkpoint for ${slug} — ${first.stderr.slice(0, 200)}`);

  return manifest;
}

export function listProjects(): { slug: string; name: string; updatedAt: number }[] {
  try {
    return readdirSync(projectsRoot())
      .map((slug) => readManifest(slug))
      .filter((m): m is Manifest => !!m)
      .map((m) => ({ slug: m.slug, name: m.name, updatedAt: m.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch { return []; }
}

// git is asked to separate fields with the unit separator rather than a space or a pipe,
// because a commit message may legitimately contain either. Named, because an invisible
// control character sitting in the source is the kind of thing an editor silently eats.
const FIELD_SEP = "\x1f";
const LOG_FORMAT = `--pretty=format:%H%x1f%s%x1f%cI`;

export interface Checkpoint { sha: string; message: string; at: string }

export function isManagedProject(slug: string): boolean {
  return existsSync(join(projectPath(slug), MANIFEST)) && existsSync(join(projectPath(slug), ".git"));
}

function requireProject(slug: string): string {
  if (!isManagedProject(slug)) throw new Error(`the yard: "${slug}" is not a managed project`);
  return projectPath(slug);
}

// Commit everything as one checkpoint. Returns null when there was genuinely nothing to
// record — an empty commit would be a checkpoint that claims work happened, and a list
// of those makes the history useless exactly when it is needed.
export async function checkpoint(slug: string, message: string, opts: { handshake?: boolean } = {}): Promise<Checkpoint | null> {
  const dir = requireProject(slug);
  const git = (args: string[]) => execInProject(dir, "git", args, { handshake: opts.handshake });

  const status = await git(["status", "--porcelain"]);
  if (!status.stdout.trim()) return null;

  await git(["add", "-A"]);
  const done = await git(["commit", "-m", String(message || "checkpoint").slice(0, 200)]);
  if (done.code !== 0) throw new Error(`the yard: the checkpoint for ${slug} failed — ${done.stderr.slice(0, 200)}`);

  const head = await git(["rev-parse", "HEAD"]);
  const sha = head.stdout.trim();
  return { sha, message, at: new Date().toISOString() };
}

export async function checkpoints(slug: string, limit = 30, opts: { handshake?: boolean } = {}): Promise<Checkpoint[]> {
  const dir = requireProject(slug);
  const r = await execInProject(dir, "git", ["log", `-n${Math.max(1, Math.min(limit, 200))}`, LOG_FORMAT], { handshake: opts.handshake });
  if (r.code !== 0) return [];
  return r.stdout.split("\n").filter(Boolean).map((line) => {
    const [sha, message, at] = line.split(FIELD_SEP);
    return { sha, message: message ?? "", at: at ?? "" };
  });
}

// Go back. Verifies the target exists in THIS project's history first, so a wrong or
// stale identifier is refused rather than acted on — a reset is destructive to
// uncommitted work, and it must never happen on a guess.
export async function restore(slug: string, sha: string, opts: { handshake?: boolean } = {}): Promise<Checkpoint> {
  const dir = requireProject(slug);
  const git = (args: string[]) => execInProject(dir, "git", args, { handshake: opts.handshake });

  const target = String(sha || "").trim();
  if (!/^[0-9a-f]{7,40}$/i.test(target)) throw new Error(`the yard: "${sha}" is not a checkpoint identifier`);

  const known = await git(["cat-file", "-t", target]);
  if (known.code !== 0 || known.stdout.trim() !== "commit") {
    throw new Error(`the yard: ${slug} has no checkpoint ${target}`);
  }

  const reset = await git(["reset", "--hard", target]);
  if (reset.code !== 0) throw new Error(`the yard: could not restore ${slug} to ${target} — ${reset.stderr.slice(0, 200)}`);
  // Remove files added since the checkpoint. Ignored paths are left alone, so installed
  // dependencies survive a restore rather than needing a reinstall.
  await git(["clean", "-fd"]);

  const head = await git(["log", "-n1", LOG_FORMAT]);
  const [head_sha, message, at] = head.stdout.split(FIELD_SEP);
  return { sha: head_sha, message: message ?? "", at: at ?? "" };
}
