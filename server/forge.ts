// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE FORGE  (Phase 5 — SAM writes its own tools)
//
//  When SAM lacks a tool for a job, it can DRAFT one: a small, pure
//  TypeScript/JS function following the Tool interface. Every draft goes
//  through a hard safety pipeline before it can ever run for real:
//
//    draft → STATIC SCAN (no eval/require/process/fs/net/shell) →
//    SANDBOX TEST (node:vm, no require, code-gen disabled, timeout) →
//    show the user the code + plain English → USER ENABLES it →
//    registered live (hot-reload).
//
//  HARD RULES (non-negotiable — the v1.2 tiers are law):
//   • Forged tools default to CONFIRM tier and can NEVER classify themselves
//     as safe. Anything touching network/fs/shell is refused outright in this
//     build (pure-computation only — the sandbox can't safely host side effects).
//   • A forged tool can never self-approve or self-enable — the user does, in
//     settings, after seeing the code.
//   • The forge itself is a CONFIRM-tier tool (it asks before drafting).
// ─────────────────────────────────────────────────────────────

import vm from "node:vm";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runModel } from "./models.ts";
import { TOOLS, Tool } from "./tools.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const FORGE_DIR = join(VAULT_DIR, "forged");
const SANDBOX_TIMEOUT_MS = 500;
const NAME_RE = /^[a-z][a-z0-9_]{2,39}$/;

export interface ForgedTool {
  name: string;
  description: string;
  params: string;
  explanation: string;   // plain-English "what it does", shown before enabling
  code: string;          // an arrow/function expression: (input) => string
  tests: { input: any; note?: string }[];
  enabled: boolean;
  createdAt: number;
  tier: "confirm";       // forged tools are ALWAYS confirm — never safe, never self-elevated
}

// ── STATIC SAFETY SCAN — reject anything that reaches outside pure computation. ──
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\beval\b/, why: "eval" },
  { re: /\bFunction\s*\(/, why: "Function constructor" },
  { re: /\brequire\b/, why: "require" },
  { re: /\bimport\b/, why: "import" },
  { re: /\bprocess\b/, why: "process" },
  { re: /\bglobalThis\b|\bglobal\b/, why: "global scope" },
  { re: /child_process|execSync|spawn/, why: "shell / child_process" },
  { re: /\bfs\b|readFile|writeFile|unlink/, why: "filesystem" },
  { re: /\bfetch\b|XMLHttpRequest|WebSocket|http[s]?:/i, why: "network" },
  { re: /node:|require\(/, why: "node builtins" },
  { re: /__proto__|prototype\s*\[|constructor\s*\[/, why: "prototype tampering" },
  { re: /\bBuffer\b|Atomics|SharedArrayBuffer|WebAssembly/, why: "low-level memory" },
  { re: /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/, why: "infinite loop" },
];
export function scanCode(code: string): { ok: boolean; violations: string[] } {
  const violations = FORBIDDEN.filter((f) => f.re.test(code)).map((f) => f.why);
  return { ok: violations.length === 0, violations };
}

// ── SANDBOX — run a forged function in a locked-down vm context, sync + time-bounded. ──
// No require/process/fs/network; code generation (eval/Function inside the vm) disabled;
// only pure JS built-ins are exposed. The timeout covers the whole synchronous call.
export function sandboxRun(code: string, input: any): string {
  const ctx: any = {
    __input: input, __result: undefined,
    JSON, Math, Date, String, Number, Array, Object, RegExp, Boolean, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  };
  vm.createContext(ctx, { codeGeneration: { strings: false, wasm: false } });
  const script = `"use strict"; const __f = (${code}); __result = String(__f(__input));`;
  vm.runInContext(script, ctx, { timeout: SANDBOX_TIMEOUT_MS });
  return String(ctx.__result ?? "");
}

// Run the auto-generated test cases in the sandbox — any throw/timeout fails the whole draft.
export function testForged(code: string, tests: { input: any }[]): { ok: boolean; error?: string; samples: { input: any; output: string }[] } {
  const samples: { input: any; output: string }[] = [];
  try {
    for (const t of (tests.length ? tests : [{ input: "" }])) samples.push({ input: t.input, output: sandboxRun(code, t.input) });
    return { ok: true, samples };
  } catch (e: any) { return { ok: false, error: String(e?.message || e), samples }; }
}

// ── STORAGE ──────────────────────────────────────────────────
function ensureDir() { if (!existsSync(FORGE_DIR)) mkdirSync(FORGE_DIR, { recursive: true }); }
function fileFor(name: string) { return join(FORGE_DIR, `${name}.json`); }

export function listForged(): ForgedTool[] {
  ensureDir();
  try {
    return readdirSync(FORGE_DIR).filter((f) => f.endsWith(".json"))
      .map((f) => { try { return JSON.parse(readFileSync(join(FORGE_DIR, f), "utf8")); } catch { return null; } })
      .filter(Boolean) as ForgedTool[];
  } catch { return []; }
}
function saveForged(t: ForgedTool) { ensureDir(); writeFileSync(fileFor(t.name), JSON.stringify(t, null, 2)); }

export function setForgedEnabled(name: string, enabled: boolean): boolean {
  const t = listForged().find((x) => x.name === name);
  if (!t) return false;
  t.enabled = enabled; saveForged(t); syncForgedRegistry();
  return true;
}
export function deleteForged(name: string): boolean {
  const f = fileFor(name);
  if (!existsSync(f)) return false;
  unlinkSync(f); syncForgedRegistry();
  return true;
}

// ── DRAFT — ask the brain for a pure function tool, then scan + test it. ──
const DRAFT_SYSTEM =
  "You write ONE small, PURE JavaScript tool for an assistant. It transforms its input and returns a string. " +
  "Rules: it MUST be a single arrow function `(input) => { ... return String }`. PURE only — no network, no files, " +
  "no shell, no require/import/eval/process, no async. Use only plain JS (String, Number, Array, Object, Math, JSON, Date, RegExp). " +
  "Return STRICT JSON: {\"name\":\"snake_case\",\"description\":\"...\",\"params\":\"{...}\",\"explanation\":\"one plain-English sentence\",\"code\":\"(input) => {...}\",\"tests\":[{\"input\":...}]}. No prose, JSON only.";

export interface DraftResult { ok: boolean; tool?: ForgedTool; reason?: string; samples?: { input: any; output: string }[] }

export async function forgeTool(need: string): Promise<DraftResult> {
  const r = await runModel("free", DRAFT_SYSTEM, `Build a tool for this need: ${need}\n\nReturn ONLY the JSON.`, "code");
  let spec: any;
  try { spec = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] || r.text); }
  catch { return { ok: false, reason: "The draft wasn't valid JSON — try rephrasing the need." }; }

  const name = String(spec?.name || "").toLowerCase().trim();
  const code = String(spec?.code || "");
  if (!NAME_RE.test(name)) return { ok: false, reason: "Bad tool name (need snake_case, 3-40 chars)." };
  if (TOOLS.some((t) => t.name === name)) return { ok: false, reason: `A tool named "${name}" already exists.` };
  if (!/=>|function/.test(code)) return { ok: false, reason: "The draft wasn't a function." };

  const scan = scanCode(code);
  if (!scan.ok) return { ok: false, reason: `Refused — the draft used a forbidden capability (${scan.violations.join(", ")}). The forge only builds pure-computation tools.` };

  const tests = Array.isArray(spec?.tests) ? spec.tests.slice(0, 5) : [];
  const test = testForged(code, tests);
  if (!test.ok) return { ok: false, reason: `The draft failed its sandbox test: ${test.error}` };

  const tool: ForgedTool = {
    name, code,
    description: String(spec?.description || need).slice(0, 200),
    params: String(spec?.params || "input"),
    explanation: String(spec?.explanation || "").slice(0, 300),
    tests, enabled: false, createdAt: Date.now(), tier: "confirm",
  };
  saveForged(tool);                    // saved DISABLED — the user reviews the code, then enables it
  return { ok: true, tool, samples: test.samples };
}

// ── LIVE REGISTRY (hot-reload) — mirror the ENABLED forged tools into TOOLS. ──
// Marked with `forged: true`; safe:false so they are CONFIRM-tier (always ask). Their run()
// executes ONLY in the sandbox — a forged tool can never escape into the real process.
export interface ForgedRuntimeTool extends Tool { forged?: true }
export function syncForgedRegistry(): number {
  // Drop any previously-registered forged tools, then re-add the enabled ones.
  for (let i = TOOLS.length - 1; i >= 0; i--) if ((TOOLS[i] as ForgedRuntimeTool).forged) TOOLS.splice(i, 1);
  let n = 0;
  for (const t of listForged()) {
    if (!t.enabled) continue;
    if (!scanCode(t.code).ok) continue;   // defence-in-depth: never register code that fails the scan
    const rt: ForgedRuntimeTool = {
      name: t.name, safe: false, forged: true,       // forged ⇒ never safe (always confirm)
      description: `${t.description} (forged by SAM)`,
      params: t.params,
      activity: () => `Running your forged tool ${t.name}`,
      preview: () => `Run the SAM-forged tool "${t.name}" — ${t.explanation}`,
      run: async (input: any) => { try { return sandboxRun(t.code, input); } catch (e: any) { return `forged tool errored: ${e?.message || e}`; } },
    };
    TOOLS.push(rt); n++;
  }
  return n;
}

export function forgedStats() {
  const all = listForged();
  return { total: all.length, enabled: all.filter((t) => t.enabled).length };
}
