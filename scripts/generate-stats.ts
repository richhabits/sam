// SAM · SINGLE SOURCE OF TRUTH for advertised numbers.
// Walks the REAL registries (not guesses) and writes docs/stats.json. The README badges, the GitHub
// Pages site, and package.json's description are all generated from this file — so the numbers can
// never drift out of sync again. Run: `npm run stats` (tsx).
import { TOOLS } from "../server/tools.ts";
import { SPECIALISTS, NINJAS } from "../server/agents.ts";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Skills = real folders under skills/ (each is a skill).
const skills = readdirSync(join(root, "skills"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith(".")).length;

// Free brains = distinct FREE providers SAM can route to. The no-key Pollinations lanes share one
// backend (openai / openai-fast / get), so they count as a single brain. Parsed straight from the
// provider registry in models.ts.
const modelsSrc = readFileSync(join(root, "server/models.ts"), "utf8");
const freeIds = [...modelsSrc.matchAll(/\{\s*id:\s*"([^"]+)",\s*tier:\s*"free"/g)].map((m) => m[1]);
const premiumIds = [...modelsSrc.matchAll(/\{\s*id:\s*"([^"]+)",\s*tier:\s*"premium"/g)].map((m) => m[1]);
const collapse = (id: string) => id.replace(/-(fast|get|mistral|large|\d+)$/, "");   // pollinations-* → pollinations
const brains = new Set(freeIds.map(collapse)).size;

const stats = {
  tools: TOOLS.length,
  agents: SPECIALISTS.length + NINJAS.length,
  specialists: SPECIALISTS.length,
  ninjas: NINJAS.length,
  skills,
  brains,                              // distinct free, no-key-capable brains
  providers: freeIds.length + premiumIds.length,   // total routing lanes incl. premium
};   // NOTE: deterministic (no timestamp) so CI can diff-check it for drift

writeFileSync(join(root, "docs/stats.json"), JSON.stringify(stats, null, 2) + "\n");

// Keep the README's advertised numbers in lockstep with reality. Regexes match "<n>+ tools/brains"
// so they stay correct no matter what the numbers become — the source of truth is stats.json.
const readmePath = join(root, "README.md");
let readme = readFileSync(readmePath, "utf8");
readme = readme
  .replace(/\b\d+\+?\s+real tools\b/g, `${stats.tools} real tools`)
  .replace(/\b\d+\+?\s+free AI brains\b/g, `${stats.brains} free AI brains`)
  .replace(/free%20AI%20brains-\d+%2B?/g, `free%20AI%20brains-${stats.brains}`)
  .replace(/\ba team of \d+ (specialist )?agents?\b/gi, `a team of ${stats.agents} agents`);
writeFileSync(readmePath, readme);

// Emit the canonical repo-description text (applied to GitHub via `gh repo edit --description`).
const repoDesc = `A free, private, local-first AI assistant that actually does the work — ${stats.tools} tools, a team of ${stats.agents} AI agents, ${stats.brains} rotating free AI brains, ${stats.skills} skills. Not a chatbot, a doer. It doesn't just answer — it handles it.`;
writeFileSync(join(root, "docs/repo-description.txt"), repoDesc + "\n");

console.log("✓ docs/stats.json + README synced →", JSON.stringify({ tools: stats.tools, agents: stats.agents, skills: stats.skills, brains: stats.brains }));
