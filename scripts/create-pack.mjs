#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  SAM · create-pack — scaffold a shareable .sampack + print how to sign + publish it.
//  Usage:  npm run create-pack "My Pack Name"
// ─────────────────────────────────────────────────────────────
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv.slice(2).join(" ").trim();
if (!name || name.length < 3) { console.error('✗ Usage: npm run create-pack "My Pack Name"'); process.exit(1); }

const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dir = join(root, "packs", id);
if (existsSync(dir)) { console.error(`✗ packs/${id} already exists`); process.exit(1); }
mkdirSync(dir, { recursive: true });

// An unsigned draft. SAM signs it on export (from inside the app), or you fill meta + sign via the app.
const draft = {
  format: "sampack/1",
  meta: { name, description: "TODO: one line — what this pack gives someone.", author: "your-handle", createdAt: 0, version: "1.0.0", dependencies: [] },
  contents: {
    skills: [
      // A skill is a markdown playbook (safe — no code). id must be snake_case.
      { id: `${id.replace(/-/g, "_")}_helper`, body: "# TODO Skill\nWhen to use this + how SAM should behave." },
    ],
    tools: [
      // Optional forged tools. Keep caps minimal; net/fs:write make a tool dangerous-tier.
      // { name: "my_tool", description: "...", params: "input", explanation: "...", code: "(i)=>String(i)", caps: [] },
    ],
    prompts: [
      { title: "TODO prompt", text: "A reusable prompt with {placeholders}." },
    ],
    watchedTemplates: [],
  },
};
writeFileSync(join(dir, `${id}.sampack.json`), JSON.stringify(draft, null, 2));

console.log(`✓ Scaffolded packs/${id}/${id}.sampack.json

Next:
  1. Fill in meta (description, author) + your skills / prompts / tools.
  2. Validate it locally:  npm run validate-packs
  3. Sign + share: export it from inside SAM (Settings → Export pack) — that signs it with your local key.
  4. Publish: open a PR to github.com/richhabits/sam-packs adding it + an index.json entry.
     CI re-verifies the signature + runs the forge static-scan on every tool before merge.

See docs/BUILD-A-PACK.md for the full guide.`);
