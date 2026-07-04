#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  SAM · skill scaffold   ·   npm run skill:new "Name"
//  Creates skills/<slug>/SKILL.md from the standard template so
//  new skills (yours or ported from GitHub) drop straight in.
// ─────────────────────────────────────────────────────────────
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error('Usage: npm run skill:new "Skill Name"');
  process.exit(1);
}

const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "skills", slug);
const file = join(dir, "SKILL.md");

if (existsSync(file)) {
  console.error(`✗ skills/${slug}/SKILL.md already exists — edit it instead.`);
  process.exit(1);
}

const template = `---
name: ${name}
tier: free
triggers: ${slug}, TODO add, comma separated, trigger keywords
---

# ${name} skill

You are SAM handling ${name.toLowerCase()} for Romeo. TODO: describe what SAM does
when this skill is active — the capability, the tone, the goal.

## Rules
- TODO: hard constraints. Never do anything irreversible without confirming first.
- Lead with the answer Romeo needs, then the detail. Tight.

## Output
- TODO: the exact shape of the reply SAM should return.
`;

mkdirSync(dir, { recursive: true });
writeFileSync(file, template);
console.log(`✓ created skills/${slug}/SKILL.md`);
console.log(`  edit the triggers + playbook, then: npm run dev`);
