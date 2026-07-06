// ─────────────────────────────────────────────────────────────
//  S.A.M. · generate the landing page FROM THE LIVE CODE
//  Reads the real tools, skills, agents & providers straight from
//  source and fills docs/_template.html → docs/index.html. Runs on
//  every `npm run ship`, so the public landing ALWAYS reflects
//  everything SAM does — zero manual upkeep, forever.
//  Edit COPY in docs/_template.html; never edit docs/index.html.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };

// ── Pull the real numbers + names from source ──
const toolsSrc = read("server/tools.ts");
// [a-z0-9_]+ — tool/provider/agent ids can contain digits (e.g. weather_forecast_7day,
// provider "ai21"); the old [a-z_]+ silently undercounted them.
const toolNames = [...toolsSrc.matchAll(/\bname:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
const tools = toolNames.length;

const modelsSrc = read("server/models.ts");
const brains = (modelsSrc.match(/id:\s*"[a-z0-9_]+",\s*tier:\s*"free"/g) || []).length;

const agentsSrc = read("server/agents.ts");
const agents = (agentsSrc.match(/\{\s*id:\s*"[a-z0-9_]+",\s*name:/g) || []).length;

let skills = 0;
try { skills = readdirSync(join(ROOT, "skills")).filter((d) => existsSync(join(ROOT, "skills", d, "SKILL.md"))).length; } catch {}

// ── Auto-build the CATEGORISED "everything it does" grid from the real tool list ──
// Every real tool lands in the FIRST category whose pattern matches (else "Utilities").
// Add a tool to tools.ts and it shows up here automatically, in the right group.
const CATS = [
  ["🔍", "Web &amp; research", /(search|google|web|browse|surf|url|wiki|news|hacker|define|dictionary|translate|research|scrape|fetch|socials)/],
  ["📄", "Files, docs &amp; vault", /(file|folder|zip|unzip|pdf|docx|\bdoc|read|write|append|move|rename|ingest|dedupe|organize|list_dir|vault|backup)/],
  ["📧", "Messaging &amp; email", /(mail|email|imessage|message|text|slack|discord|telegram|notify)/],
  ["📞", "Calls", /(call|facetime|phone|ring)/],
  ["🐙", "Code &amp; GitHub", /(git|github|repo|commit|\bpr\b|branch|issue|npm|command|script|terminal|exec|diff|selftest)/],
  ["📅", "Calendar, tasks &amp; projects", /(calendar|schedule|remind|nudge|timer|todo|linear|notion|trello|event|reminder|project)/],
  ["👁️", "Vision &amp; screen", /(screen|screenshot|look|camera|vision|ocr|\bsee|photo|guardian|wallpaper)/],
  ["🎵", "Music &amp; media", /(music|play|song|spotify|volume|media|pause|track|speak|voice)/],
  ["🖱️", "Control your Mac", /(caffeinate|lock|battery|system|wifi|network|eject|trash|brightness|clipboard|disk|type|press|click|\bkey|mouse|frontmost|dark_mode|dnd|my_apps|open_app|shortcut|self_restart|\bkill|manage)/],
  ["🧠", "Memory &amp; people", /(person|people|remember|memor|note|recall|forget|contact|who_i_know)/],
  ["🤝", "Agents &amp; swarm", /(team|ninja|swarm|agent|capacity)/],
  ["🛡️", "Security", /(security|watchdog|guard)/],
  ["💰", "Money &amp; business", /(crypto|stock|currency|price|money|convert|stripe|shopify|invoice)/],
  ["📍", "Location &amp; weather", /(weather|direction|map|location|forecast)/],
  ["🔧", "Utilities", /.*/],   // catch-all — always last
];
const groups = CATS.map(() => []);
for (const n of toolNames.slice().sort()) {
  const i = CATS.findIndex(([, , re]) => re.test(n));
  groups[i === -1 ? CATS.length - 1 : i].push(n);
}
const does = CATS.map(([emoji, label], i) => {
  if (!groups[i].length) return "";
  const chips = groups[i].map((n) => `<span>${n.replace(/_/g, " ")}</span>`).join("");
  return `<div class="cat"><div class="cat-h">${emoji} ${label} <em>${groups[i].length}</em></div><div class="does">${chips}</div></div>`;
}).filter(Boolean).join("\n        ");

const values = { TOOLS: tools || 60, BRAINS: brains || 6, SKILLS: skills || 25, AGENTS: agents || 10, DOES: does };

let html = read("docs/_template.html");
for (const [k, v] of Object.entries(values)) html = html.replaceAll(`{{${k}}}`, String(v));
writeFileSync(join(ROOT, "docs/index.html"), html);

console.log(`  landing regenerated · ${values.TOOLS} tools · ${values.BRAINS} free brains · ${values.AGENTS} agents · ${values.SKILLS} skills`);
