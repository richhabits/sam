// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the Playbook
//
//  The operator's working method already IS long master prompts — this is what makes
//  them first-class instead of something copy-pasted from a notes file each time. One
//  JSON file per playbook, under the yard's own root (~/SAMYard/playbooks), same as
//  everything else the yard keeps outside the repo. Never bundled into git: this
//  directory does not exist inside SAM's source tree at all.
//
//  Parameterised with {{name}} placeholders, filled by a small form on run and
//  remembered per playbook — so "run this against {{project}}" doesn't mean retyping
//  the project name every time. Each save that actually changes the template body bumps
//  the version, and a run records which version it used, so a task's provenance stays
//  legible even after the playbook has since been edited.
// ─────────────────────────────────────────────────────────────

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { yardRoot } from "./managed.ts";

// No separate override: SAMYARD_DIR (already yardRoot()'s own test/config hook) relocates
// this too, one knob instead of two.
export function playbooksDir(): string {
  return join(yardRoot(), "playbooks");
}

export interface Playbook {
  id: string;
  name: string;
  template: string;                    // the master prompt, with {{name}} placeholders
  params: string[];                    // extracted from the template, for the run form
  lastValues: Record<string, string>;  // remembered per playbook, prefilled on next run
  version: number;
  createdAt: number;
  updatedAt: number;
}

const PARAM_RE = /\{\{(\w+)\}\}/g;

export function extractParams(template: string): string[] {
  const found = new Set<string>();
  for (const m of String(template || "").matchAll(PARAM_RE)) found.add(m[1]);
  return [...found];
}

// Anything left unfilled stays as the literal {{placeholder}} rather than vanishing —
// a blank in the middle of a prompt is a silent lie about what was actually asked.
export function renderTemplate(template: string, values: Record<string, string>): string {
  return String(template || "").replace(PARAM_RE, (m, name) => (values?.[name]?.trim() ? values[name] : m));
}

function ensureDir(): void {
  if (!existsSync(playbooksDir())) mkdirSync(playbooksDir(), { recursive: true });
}
function filePath(id: string): string {
  return join(playbooksDir(), `${id}.json`);
}

// IDs are server-generated (randomUUID), never taken from a client path segment used to
// build a file path elsewhere — but reads/deletes below still resolve through filePath()
// off a fixed directory, so even a malformed id can't escape playbooksDir().
function safeId(id: string): string {
  return /^[A-Za-z0-9-]{1,80}$/.test(id) ? id : "";
}

export function listPlaybooks(): Playbook[] {
  ensureDir();
  return readdirSync(playbooksDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try { return JSON.parse(readFileSync(join(playbooksDir(), f), "utf8")) as Playbook; }
      catch { return null; }
    })
    .filter((p): p is Playbook => !!p)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPlaybook(id: string): Playbook | null {
  const safe = safeId(id);
  if (!safe) return null;
  try { return JSON.parse(readFileSync(filePath(safe), "utf8")); }
  catch { return null; }
}

export function savePlaybook(input: { id?: string; name: string; template: string; lastValues?: Record<string, string> }): Playbook {
  ensureDir();
  const now = Date.now();
  const existing = input.id ? getPlaybook(input.id) : null;
  const templateChanged = !existing || existing.template !== input.template;
  const pb: Playbook = {
    id: existing?.id ?? randomUUID(),
    name: String(input.name || "").trim().slice(0, 120) || "Untitled playbook",
    template: String(input.template || ""),
    params: extractParams(input.template),
    lastValues: input.lastValues ?? existing?.lastValues ?? {},
    version: existing ? (templateChanged ? existing.version + 1 : existing.version) : 1,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  writeFileSync(filePath(pb.id), JSON.stringify(pb, null, 2));
  return pb;
}

export function deletePlaybook(id: string): boolean {
  const safe = safeId(id);
  if (!safe) return false;
  try { unlinkSync(filePath(safe)); return true; }
  catch { return false; }
}

// A dropped .md becomes a playbook straight away. "# Title" on the first line names it;
// otherwise the filename does, and the whole text is the template verbatim either way.
export function importMarkdown(text: string, filename?: string): Playbook {
  const lines = String(text || "").split("\n");
  const first = (lines[0] || "").trim();
  const titled = /^#\s+/.test(first);
  const name = titled ? first.replace(/^#+\s*/, "") : (filename || "").replace(/\.md$/i, "") || "Imported playbook";
  const template = (titled ? lines.slice(1).join("\n") : text).trim();
  return savePlaybook({ name, template });
}
