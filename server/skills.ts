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
  body: string; // full SKILL.md content (the playbook)
}

// Parse the YAML-ish front matter at the top of each SKILL.md
function parseFrontMatter(raw: string) {
  const meta: Record<string, string> = {};
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta, body: raw };
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > -1) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

export function loadSkills(): Skill[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const skills: Skill[] = [];
  for (const dir of readdirSync(SKILLS_DIR)) {
    const path = join(SKILLS_DIR, dir, "SKILL.md");
    if (!existsSync(path)) continue;
    const { meta, body } = parseFrontMatter(readFileSync(path, "utf8"));
    skills.push({
      id: dir,
      name: meta.name || dir,
      tier: (meta.tier as any) || "free",
      triggers: (meta.triggers || "").split(",").map((s) => s.trim()).filter(Boolean),
      body,
    });
  }
  return skills;
}

// Pick the best skill for a message by trigger-word overlap.
// Cheap, deterministic, no model call — this is the "regex" route
// from the slide deck before anything hits a model.
export function routeSkill(message: string, skills: Skill[]): Skill | null {
  const text = message.toLowerCase();
  let best: { skill: Skill; score: number } | null = null;
  for (const s of skills) {
    const score = s.triggers.reduce(
      (acc, t) => (text.includes(t.toLowerCase()) ? acc + 1 : acc),
      0
    );
    if (score > 0 && (!best || score > best.score)) best = { skill: s, score };
  }
  return best?.skill || null;
}
