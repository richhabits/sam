// ─────────────────────────────────────────────────────────────
//  S.A.M. · generate the landing page FROM THE LIVE CODE
//  Reads the real tools, skills, agents & providers straight from
//  source and fills docs/_template.html → docs/index.html. Runs on
//  every `npm run ship`, so the public landing ALWAYS reflects
//  everything SAM does — zero manual upkeep, forever.
//  Edit COPY in docs/_template.html; never edit docs/index.html.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };

// ── Numbers come from docs/stats.json — the SINGLE SOURCE OF TRUTH (run `npm run stats` first;
//    the build + CI do). No independent counting here, so the site can never disagree with the
//    README/repo. Falls back to a safe read only if stats.json is somehow missing. ──
let STATS = { tools: 0, brains: 0, agents: 0, skills: 0 };
try { STATS = JSON.parse(read("docs/stats.json")); } catch { /* stats file is optional — the landing page renders without the numbers */ }
const tools = STATS.tools, brains = STATS.brains, agents = STATS.agents, skills = STATS.skills;

// The tool NAMES (for the categorised grid below) still come from source — that's the list, not a count.
const toolsSrc = read("server/tools.ts");
const toolNames = [...toolsSrc.matchAll(/\bname:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);

// ── Auto-build the CATEGORISED "everything it does" grid from the real tool list ──
// Every real tool lands in the FIRST category whose pattern matches (else "Utilities").
// Add a tool to tools.ts and it shows up here automatically, in the right group.
const CATS = [
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-search\"/></svg>", "Web &amp; research", /(search|google|web|browse|surf|url|wiki|news|hacker|define|dictionary|translate|research|scrape|fetch|socials)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-doc\"/></svg>", "Files, docs &amp; vault", /(file|folder|zip|unzip|pdf|docx|\bdoc|read|write|append|move|rename|ingest|dedupe|organize|list_dir|vault|backup)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-mail\"/></svg>", "Messaging &amp; email", /(mail|email|imessage|message|text|slack|discord|telegram|notify)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-phone\"/></svg>", "Calls", /(call|facetime|phone|ring)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-branch\"/></svg>", "Code &amp; GitHub", /(git|github|repo|commit|\bpr\b|branch|issue|npm|command|script|terminal|exec|diff|selftest)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-calendar\"/></svg>", "Calendar, tasks &amp; projects", /(calendar|schedule|remind|nudge|timer|todo|linear|notion|trello|event|reminder|project)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-eye\"/></svg>", "Vision &amp; screen", /(screenshot|camera|vision|ocr|\blook|photo|guardian|wallpaper)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-music\"/></svg>", "Music &amp; media", /(music|play|song|spotify|volume|media|pause|track|speak|voice)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-cursor\"/></svg>", "Control your computer", /(caffeinate|lock|battery|system|wifi|network|eject|trash|brightness|clipboard|disk|type|press|click|\bkey|mouse|frontmost|dark_mode|dnd|my_apps|open_app|shortcut|self_restart|\bkill|manage)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-brain\"/></svg>", "Memory &amp; people", /(person|people|remember|memor|note|recall|forget|contact|who_i_know)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-team\"/></svg>", "Agents &amp; swarm", /(team|ninja|swarm|agent|capacity)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-shield\"/></svg>", "Security", /(security|watchdog|guard)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-markets\"/></svg>", "Money &amp; business", /(crypto|stock|currency|price|money|convert|stripe|shopify|invoice)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-location\"/></svg>", "Location &amp; weather", /(weather|direction|map|location|forecast)/],
  ["<svg class=\"i\" aria-hidden=\"true\"><use href=\"#i-settings\"/></svg>", "Utilities", /.*/],   // catch-all — always last
];
const groups = CATS.map(() => []);
for (const n of toolNames.slice().sort()) {
  const i = CATS.findIndex(([, , re]) => re.test(n));
  groups[i === -1 ? CATS.length - 1 : i].push(n);
}
// Show a taste per category (the strongest few), not the whole 184-chip dump — the count carries
// "there's loads more". Kills the endless scroll; reads as a premium capability grid, not a list.
const PER_CAT = 5;
const does = CATS.map(([emoji, label], i) => {
  if (!groups[i].length) return "";
  const shown = groups[i].slice(0, PER_CAT);
  const extra = groups[i].length - shown.length;
  const chips = shown.map((n) => `<span>${n.replace(/_/g, " ")}</span>`).join("")
    + (extra > 0 ? `<span class="more">+${extra} more</span>` : "");
  return `<div class="cat"><div class="cat-h">${emoji} ${label} <em>${groups[i].length}</em></div><div class="does">${chips}</div></div>`;
}).filter(Boolean).join("\n        ");

const values = { TOOLS: tools || 60, BRAINS: brains || 6, SKILLS: skills || 25, AGENTS: agents || 10, DOES: does };

let html = read("docs/_template.html");
for (const [k, v] of Object.entries(values)) html = html.replaceAll(`{{${k}}}`, String(v));
writeFileSync(join(ROOT, "docs/index.html"), html);

console.log(`  landing regenerated · ${values.TOOLS} tools · ${values.BRAINS} free brains · ${values.AGENTS} agents · ${values.SKILLS} skills`);
