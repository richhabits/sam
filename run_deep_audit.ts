#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import "dotenv/config";
import { execSync, execFileSync } from "node:child_process";

const CODEMAP_STATE = ".codemap/modules.json";
const APPLY_SCRIPT  = ".agents/skills/codemap-skill/scripts/apply_audit.py";
const RENDER_SCRIPT = ".agents/skills/codemap-skill/scripts/render.py";
const SCAN_SCRIPT   = ".agents/skills/codemap-skill/scripts/scan.py";
const TEMPLATE_HTML = ".agents/skills/codemap-skill/assets/template.html";

const VALID_TAGS = new Set([
  "monkeypatch","fallback","silent-except","silent-catch","legacy","dual-format",
  "stub","fake-output","duplication","bloat","glue","any-escape",
  "over-fit","god-component","placeholder","clean",
]);

function gradeFor(score: number): string {
  return score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
}

function collectCode(mod: any, maxBytes = 28000): string {
  const chunks: string[] = [];
  let total = 0;
  for (const pattern of (mod.paths || []) as string[]) {
    let files: string[] = [];
    try {
      const out = execSync(
        `python3 -c "import glob,json,sys; print(json.dumps(glob.glob(sys.argv[1], recursive=True)))" "${pattern}"`,
        { encoding: "utf8" }
      ).trim();
      files = (JSON.parse(out) as string[]).filter(
        (f: string) => !f.includes("node_modules") && !f.includes("dist/") && !f.includes(".codemap")
      );
    } catch { files = []; }
    for (const f of files) {
      if (!existsSync(f)) continue;
      try {
        const txt = readFileSync(f, "utf-8");
        const lines = txt.split("\n").length;
        const snippet = `\n--- ${f} (${lines} lines) ---\n${txt.slice(0, 6000)}`;
        chunks.push(snippet);
        total += snippet.length;
        if (total > maxBytes) break;
      } catch {
        /* file read failed, skip snippet */
      }
    }
    if (total > maxBytes) break;
  }
  return chunks.join("");
}

function extractJson(text: string): string {
  text = text.trim()
    .replace(/^```json\s*/m, "")
    .replace(/^```\s*/m, "")
    .replace(/\s*```$/m, "");
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

function validate(data: any) {
  let score: number;
  try { score = parseInt(data.score, 10); if (Number.isNaN(score)) throw 0; }
  catch { return { ok: false, err: "missing/invalid 'score'" }; }
  if (score < 0 || score > 100) return { ok: false, err: `score out of range: ${score}` };
  
  const grade = String(data.grade || "").trim().toUpperCase()[0];
  if (!["A","B","C","D","F"].includes(grade)) return { ok: false, err: `invalid grade: ${data.grade}` };
  if (grade !== gradeFor(score)) data.grade = gradeFor(score);
  
  const tags: string[] = (Array.isArray(data.tags) ? data.tags : ["clean"]).map(t => t === "silent-catch" ? "silent-except" : t);
  data.tags = tags;
  const unknown = tags.filter(t => !VALID_TAGS.has(t));
  if (unknown.length) return { ok: false, err: `unknown tags: ${JSON.stringify(unknown)}` };
  
  const nonclean = tags.filter(t => t !== "clean");
  if (tags.includes("clean") && nonclean.length) return { ok: false, err: "'clean' cannot coexist with problem tags" };
  if (tags.includes("clean") && score < 75) {
    data.tags = ["legacy"];
    data.findings = data.findings?.length ? data.findings : [{ sev: "LOW", loc: `${data.summary || "module"}:1`, text: "Module scored below clean threshold; review for minor issues." }];
  }

  const findings: any[] = Array.isArray(data.findings) ? data.findings : [];
  data.findings = findings;
  for (const f of findings) {
    const sev = String(f.sev || "").toUpperCase();
    if (!["HIGH","MED","LOW"].includes(sev)) return { ok: false, err: `finding sev must be HIGH/MED/LOW, got ${f.sev}` };
    f.sev = sev;
    if (!String(f.loc || "").trim()) f.loc = "module:1";
    if (!String(f.text || "").trim()) return { ok: false, err: "finding 'text' is empty" };
  }
  const noncleanFinal = (data.tags as string[]).filter(t => t !== "clean");
  if (noncleanFinal.length && findings.length === 0) {
    data.findings = [{ sev: "LOW", loc: "module:1", text: `Module has smell tags ${JSON.stringify(noncleanFinal)} — review for details.` }];
  }
  return { ok: true };
}

const SYSTEM = `You are a strict, heavily-researched code-quality auditor. Return ONLY a raw JSON object — zero prose, zero markdown fences.

Required schema:
{
  "score": <int 0-100>,
  "grade": <"A"|"B"|"C"|"D"|"F">,
  "summary": "<one sentence>",
  "tags": ["<tag>", ...],
  "findings": [{"sev":"<HIGH|MED|LOW>","loc":"<file:line>","text":"<desc>"}]
}

Scoring:
90-100=A (clean), 75-89=B (minor issues), 60-74=C (real bloat/hacks), 40-59=D (legacy/stubs), 0-39=F (broken/fake)

Tags (use EXACT strings): monkeypatch, fallback, silent-except, silent-catch, legacy, dual-format, stub, fake-output, duplication, bloat, glue, any-escape, over-fit, god-component, placeholder, clean
- "clean" = no other tags, score>=75
- Non-clean modules MUST have at least one finding with real file:line citation
- Be rigorous — a HIGH finding rarely scores above 60

IMPORTANT: You are provided with "LIVE RESEARCH TRUTHS" below the source code. You MUST judge the module against these real-world architectural best practices. Do not hallucinate standards.

Return ONLY JSON. No markdown. No explanation. No preamble.`;

// Removed tools.ts import to avoid better-sqlite3 segfaults in this script
const ROTATING_UAS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
];

async function liveResearch(label: string) {
  const query = encodeURIComponent(`${label} architectural code best practices 2024 github`);
  const ua = ROTATING_UAS[Math.floor(Math.random() * ROTATING_UAS.length)];
  try {
    const sr = await fetch("https://searx.be/search?q=" + query + "&format=json", { headers: { "User-Agent": ua } });
    if (sr.ok) {
      const sJson = await sr.json();
      if (sJson.results && sJson.results.length > 0) {
        return sJson.results.slice(0, 3).map((r: any) => `• ${r.title} — ${r.content || ""}`).join("\n");
      }
    }
  } catch {
    /* live research failed */
  }
  return "Live research unavailable.";
}

async function auditModule(mod: any): Promise<any | null> {
  const { id, label, desc = "" } = mod;
  console.log(`\n${"=".repeat(52)}`);
  console.log(`🔍 [${id}] ${label}`);

  const code = collectCode(mod);
  if (!code.trim()) {
    console.log(`  ⚠️  No source files found — skipping.`);
    return null;
  }
  console.log(`  📄 Collected ${code.length.toLocaleString()} chars of source`);

  // Phase 2: Live Research
  console.log(`  🌐 Searching live web for best practices regarding: ${label}...`);
  const researchText = await liveResearch(label);
  console.log(`  🔎 Found live truths to cross-reference against!`);

  const user = `Audit this module:
Module: ${id} — ${label}
Desc: ${desc}

SOURCE:
${code.slice(0, 32000)}

--- LIVE RESEARCH TRUTHS (Cross-reference these against the code) ---
${researchText}

Return ONLY the JSON object.`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`  🧠 LLM attempt ${attempt}/3 (Deep Truth)...`);
    try {
      const apiKey = process.env.GEMINI_API_KEYS?.split(",")[0] || process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("No Gemini key in .env");
      
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: 6000, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (!r.ok) throw new Error(`Gemini HTTP ${r.status}`);
      const d: any = await r.json();
      const raw = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
      
      const jsonStr = extractJson(raw);
      let data: any;
      try { data = JSON.parse(jsonStr); } catch (_e) {
        console.log(`  ⚠️  JSON parse failed. Raw snippet: ${raw.slice(0, 200).replace(/\n/g, " ")}...`);
        continue;
      }
      const v = validate(data);
      if (!v.ok) { console.log(`  ⚠️  Validation: ${(v as any).err}. Raw JSON: ${jsonStr.slice(0, 200).replace(/\n/g, " ")}...`); continue; }
      console.log(`  ✅ score=${data.score} grade=${data.grade} tags=${JSON.stringify(data.tags)} findings=${data.findings.length}`);
      return data;
    } catch (e: any) {
      console.log(`  ❌ LLM error: ${e.message}`);
    }
  }
  console.log(`  ❌ All 3 attempts failed.`);
  return null;
}

function applyResult(id: string, data: any): boolean {
  const tmp = `.codemap/temp_audit_${id}.json`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  try {
    const out = execFileSync("python3", [APPLY_SCRIPT, "--state", CODEMAP_STATE, "--id", id, "--json-file", tmp], { encoding: "utf8" });
    console.log(`  📝 ${out.trim()}`);
    return true;
  } catch (e: any) {
    const stderr = e.stderr || e.message || "";
    console.log(`  ❌ apply_audit rejected: ${stderr.trim()}`);
    return false;
  } finally {
    try { execSync(`rm -f "${tmp}"`); } catch {
      /* ignore cleanup error */
    }
  }
}

async function main() {
  console.log("🚀 SAM Deep Truth CodeMap Audit\n");

  const scanOut = execSync(`python3 ${SCAN_SCRIPT} --root . --state ${CODEMAP_STATE} --write`, { encoding: "utf8" });
  const scan = JSON.parse(scanOut);
  
  // Dynamically target all stale modules identified by scan.py
  const needsAudit: string[] = scan.needs_audit?.length ? scan.needs_audit : ["client-app"];
  
  console.log(`📋 Running Deep Truth Pass on stale modules: ${needsAudit.join(", ")}`);

  const state = JSON.parse(readFileSync(CODEMAP_STATE, "utf-8"));
  const applied: string[] = [];
  const failed: string[] = [];

  for (const mid of needsAudit) {
    const mod = state.modules.find((m: any) => m.id === mid);
    if (!mod) { failed.push(mid); continue; }
    const result = await auditModule(mod);
    if (result && applyResult(mid, result)) {
      applied.push(mid);
    } else {
      failed.push(mid);
    }
  }

  console.log(`\n${"=".repeat(52)}`);
  console.log(`✅ Applied:  ${applied.length}/${needsAudit.length} — ${applied.join(", ")}`);
  if (failed.length) console.log(`❌ Failed:   ${failed.join(", ")}`);

  console.log("🎨 Rendering map...");
  execSync(`python3 ${RENDER_SCRIPT} --state ${CODEMAP_STATE} --template ${TEMPLATE_HTML} --out-html .codemap/codemap.html --out-md .codemap/codemap.md`, { stdio: "inherit" });
  console.log(`\n🎯 Deep Truth Map → .codemap/codemap.html`);
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
