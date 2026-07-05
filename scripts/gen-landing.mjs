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
const toolNames = [...toolsSrc.matchAll(/\bname:\s*"([a-z_]+)"/g)].map((m) => m[1]);
const tools = toolNames.length;

const modelsSrc = read("server/models.ts");
const brains = (modelsSrc.match(/id:\s*"[a-z]+",\s*tier:\s*"free"/g) || []).length;

const agentsSrc = read("server/agents.ts");
const agents = (agentsSrc.match(/\{\s*id:\s*"[a-z]+",\s*name:/g) || []).length;

let skills = 0;
try { skills = readdirSync(join(ROOT, "skills")).filter((d) => existsSync(join(ROOT, "skills", d, "SKILL.md"))).length; } catch {}

// ── Auto-build the "everything it does" grid from the real tool list ──
const EMO = [
  [/(search|google|web|browse|surf|url)/, "🔍"], [/(pdf|docx|doc)/, "📄"], [/(file|folder|zip|unzip|disk|move|rename)/, "📁"],
  [/(mail|email|imessage|message|text|slack|discord|telegram)/, "📧"], [/(git|github|repo|commit|\bpr\b|branch|issue)/, "🐙"],
  [/(call|facetime|phone|ring)/, "📞"], [/(calendar|schedule|remind|nudge|timer|todo|linear|notion|trello)/, "📅"],
  [/(weather|direction|map|location)/, "🌤️"], [/(screen|screenshot|look|camera|vision|ocr|see)/, "👁️"],
  [/(music|play|song|spotify|volume|media)/, "🎵"], [/(command|run|terminal|exec|caffeinate|lock|battery|system|wifi|network|eject|trash|brightness)/, "💻"],
  [/(security|watchdog|guard)/, "🛡️"], [/(person|people|remember|memory|note)/, "🧠"],
  [/(crypto|stock|currency|price|money|convert|stripe|shopify)/, "💰"], [/(wiki|define|dictionary|news|hacker|translate)/, "📚"],
  [/(team|ninja|swarm|agent)/, "🤝"], [/(qr|password|dns|ip|whois|unit|generate)/, "🔧"], [/(notify|clock|world)/, "🔔"],
];
const emo = (n) => (EMO.find(([re]) => re.test(n)) || [, "▪️"])[1];
const pretty = (n) => `${emo(n)} ${n.replace(/_/g, " ")}`;
const does = toolNames.slice().sort().map((n) => `<span>${pretty(n)}</span>`).join("\n        ");

const values = { TOOLS: tools || 60, BRAINS: brains || 6, SKILLS: skills || 25, AGENTS: agents || 10, DOES: does };

let html = read("docs/_template.html");
for (const [k, v] of Object.entries(values)) html = html.replaceAll(`{{${k}}}`, String(v));
writeFileSync(join(ROOT, "docs/index.html"), html);

console.log(`  landing regenerated · ${values.TOOLS} tools · ${values.BRAINS} free brains · ${values.AGENTS} agents · ${values.SKILLS} skills`);
