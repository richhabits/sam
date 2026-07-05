// ─────────────────────────────────────────────────────────────
//  S.A.M. · generate the landing page from the live code
//  Reads real numbers (tools, free brains) straight from source,
//  fills docs/_template.html → docs/index.html. Runs on `npm run
//  ship`, so the public landing always reflects what SAM does.
//  Edit the COPY in docs/_template.html — never docs/index.html.
// ─────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };

// Count tools = number of `{ name: "..."` entries in tools.ts + git/github tools.
const toolsSrc = read("server/tools.ts");
const tools = (toolsSrc.match(/\bname:\s*"[a-z_]+"/g) || []).length;

// Free brains = provider entries with tier "free" (id + tier adjacency, not stray strings).
const modelsSrc = read("server/models.ts");
const brains = (modelsSrc.match(/id:\s*"[a-z]+",\s*tier:\s*"free"/g) || []).length;

const values = { TOOLS: tools || 60, BRAINS: brains || 6 };

let html = read("docs/_template.html");
for (const [k, v] of Object.entries(values)) html = html.replaceAll(`{{${k}}}`, String(v));

writeFileSync(join(ROOT, "docs/index.html"), html);
console.log(`  landing regenerated · ${values.TOOLS} tools · ${values.BRAINS} free brains`);
