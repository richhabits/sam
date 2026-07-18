// ─────────────────────────────────────────────────────────────
//  SAM · SKILL LOADER  (THE BRAIN)
//  Each skill is a folder under /skills with a SKILL.md.
//  SAM loads only the metadata at boot, then injects the full
//  body of whichever skill the router selects — "Claude loads
//  only what the moment needs."
// ─────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(__dirname, "..", "skills");

export interface Skill {
  id: string;
  name: string;
  tier: "local" | "free" | "premium";
  triggers: string[]; // keywords that route to this skill
  tools?: string[]; // capability allowlist — when set, the agent may ONLY run these tools
  body: string; // full SKILL.md content (the playbook)
}

// Parse the YAML-ish front matter at the top of each SKILL.md. Supports `key: value`, an inline
// list `key: [a, b]`, and a block list (`key:` then `  - a` lines) — enough for a `tools:` array.
export function parseFrontMatter(raw: string) {
  const meta: Record<string, string | string[]> = {};
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta, body: raw };
  let listKey: string | null = null;
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s*-\s+(.*)$/);
    if (listKey && item) { (meta[listKey] as string[]).push(unquote(item[1])); continue; }
    listKey = null;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (val === "") { meta[key] = []; listKey = key; }                         // block list follows
    else if (val.startsWith("[") && val.endsWith("]")) {                       // inline list
      meta[key] = val.slice(1, -1).split(",").map(unquote).filter(Boolean);
    } else meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");

// Normalise a frontmatter value that may be a string, a CSV string, or already a list.
function asList(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v.trim()) return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

export function loadSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const skills: Skill[] = [];
  for (const dir of readdirSync(SKILLS_DIR)) {
    const path = join(SKILLS_DIR, dir, "SKILL.md");
    if (!existsSync(path)) continue;
    const { meta, body } = parseFrontMatter(readFileSync(path, "utf8"));
    const declared = asList(meta.tools);
    skills.push({
      id: dir,
      name: (typeof meta.name === "string" && meta.name) || dir,
      tier: (meta.tier as any) || "free",
      triggers: asList(meta.triggers),
      // only set an allowlist when the skill actually declares tools — undefined = unrestricted
      tools: declared.length ? declared : undefined,
      body,
    });
  }
  return skills;
}

// Load-time safety net: warn about any skill that declares a tool SAM doesn't have (a typo would
// otherwise silently deny that tool forever). Call once at boot with the real tool-name set.
export function validateSkillTools(skills: Skill[], validNames: Set<string>): string[] {
  const warnings: string[] = [];
  for (const s of skills) {
    for (const t of s.tools ?? []) {
      if (!validNames.has(t)) warnings.push(`skill "${s.id}" declares unknown tool "${t}"`);
    }
  }
  return warnings;
}

// Pick the best skill for a message by trigger-word overlap.
// Cheap, deterministic, no model call — this is the "regex" route
// from the slide deck before anything hits a model.
export function routeSkill(message: string, skills: Skill[]): Skill | null {
  const text = message.toLowerCase();
  let best: { skill: Skill; score: number } | null = null;
  for (const s of skills) {
    // Weight a match by how SPECIFIC the trigger is (word count), not just that it hit.
    // Counting matches equally let a generic single word outrank a precise phrase: "I want to
    // build my own git" scored build=2 ("build","git") vs buildx=1 ("build my own"), so the
    // build-your-own skill never fired on its own flagship request. A three-word phrase is
    // stronger evidence of intent than one common word, and scoring says so.
    const score = s.triggers.reduce(
      (acc, t) => (text.includes(t.toLowerCase()) ? acc + t.trim().split(/\s+/).length : acc),
      0
    );
    if (score > 0 && (!best || score > best.score)) best = { skill: s, score };
  }
  return best?.skill || null;
}
