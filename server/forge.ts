// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE FORGE  (v1.4 Phase 5 + v1.5 tier-2 capabilities)
//
//  When SAM lacks a tool, it can DRAFT one behind a hard safety pipeline:
//    draft → STATIC SCAN → SANDBOX TEST (node:vm, nothing ambient, timeout)
//    → show the user the code + declared capabilities → USER ENABLES → live.
//
//  CAPABILITIES (v1.5): a forged tool may declare capabilities up front —
//  `net`, `fs:read`, `fs:write`. The sandbox injects ONLY the declared
//  capability as a `sam.*` shim; nothing ambient is reachable (no bare fetch,
//  require, process, fs). Capability ⇒ tier:
//    • pure (no caps) or fs:read  → CONFIRM
//    • net or fs:write            → DANGEROUS (always asks, never auto-runs)
//    • shell / exec               → FORBIDDEN to forge, permanently.
//
//  HARD RULES: a forged tool can never mark itself safe, never self-approve/
//  self-enable (the user does, after seeing the code + caps), and its run()
//  executes ONLY in the sandbox. The forge tool itself is CONFIRM-tier.
// ─────────────────────────────────────────────────────────────

import vm from "node:vm";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { readFile as fsRead, writeFile as fsWrite } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runModel } from "./models.ts";
import { TOOLS, Tool } from "./tools.ts";
import { markDangerous, unmarkDangerous } from "./authz.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const FORGE_DIR = join(VAULT_DIR, "forged");
const FORGE_FS = join(VAULT_DIR, "forge-fs");      // per-tool sandbox for fs:read / fs:write
const SANDBOX_TIMEOUT_MS = 500;                     // sync compile bound
const CALL_TIMEOUT_MS = 12_000;                     // async wall-clock bound (net/fs tools)
const NAME_RE = /^[a-z][a-z0-9_]{2,39}$/;
const NET_MAX_BYTES = 256 * 1024;

export type Capability = "net" | "fs:read" | "fs:write";
export const ALL_CAPS: Capability[] = ["net", "fs:read", "fs:write"];

export interface ForgedTool {
  name: string;
  description: string;
  params: string;
  explanation: string;
  code: string;                  // (input, sam) => string | Promise<string>
  caps: Capability[];            // declared capabilities (empty = pure)
  tests: { input: any; note?: string }[];
  enabled: boolean;
  createdAt: number;
  tier: "confirm" | "dangerous"; // derived from caps; forged is NEVER safe
}

// net or fs:write can move data off the machine or mutate files → dangerous. Pure/fs:read → confirm.
export function tierForCaps(caps: Capability[]): "confirm" | "dangerous" {
  return caps.some((c) => c === "net" || c === "fs:write") ? "dangerous" : "confirm";
}

// ── STATIC SAFETY SCAN — block every ambient escape; capabilities go ONLY through sam.* ──
const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\beval\b/, why: "eval" },
  { re: /\bFunction\s*\(/, why: "Function constructor" },
  { re: /\brequire\b/, why: "require" },
  { re: /\bimport\b/, why: "import" },
  { re: /\bprocess\b/, why: "process" },
  { re: /\bglobalThis\b|\bglobal\b/, why: "global scope" },
  { re: /child_process|execSync|\bspawn\b|\bexec\b/, why: "shell / child_process (forbidden forever)" },
  { re: /node:|require\(/, why: "node builtins" },
  { re: /__proto__|prototype\s*\[|constructor\s*\[|\.constructor\b/, why: "prototype tampering" },
  { re: /\bBuffer\b|Atomics|SharedArrayBuffer|WebAssembly/, why: "low-level memory" },
  { re: /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/, why: "infinite loop" },
  { re: /XMLHttpRequest|WebSocket/, why: "raw network object" },
  // bare (ambient) fetch/fs NOT via the sam.* shim
  { re: /(^|[^.\w])fetch\s*\(/, why: "ambient fetch (use sam.fetch after declaring `net`)" },
];

export function scanCode(code: string, caps: Capability[] = []): { ok: boolean; violations: string[] } {
  const violations = FORBIDDEN.filter((f) => f.re.test(code)).map((f) => f.why);
  // Capability-declaration enforcement: using a sam.* shim REQUIRES declaring the matching capability.
  if (/\bsam\.fetch\b/.test(code) && !caps.includes("net")) violations.push("uses sam.fetch without declaring `net`");
  if (/\bsam\.readFile\b/.test(code) && !caps.includes("fs:read")) violations.push("uses sam.readFile without declaring `fs:read`");
  if (/\bsam\.writeFile\b/.test(code) && !caps.includes("fs:write")) violations.push("uses sam.writeFile without declaring `fs:write`");
  return { ok: violations.length === 0, violations };
}

// ── CAPABILITY SHIMS — the ONLY doorway to net/fs. Injected per declared capability. ──
// fs is confined to a per-tool sandbox dir (no traversal, no access to the wider disk); net is
// http(s) only, size- and time-bounded. Nothing here is reachable unless the tool declared it.
function toolSandboxDir(name: string): string {
  const dir = join(FORGE_FS, name.replace(/[^a-z0-9_]/gi, "_"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
function safeName(p: string): string { return basename(String(p || "")).replace(/[^a-z0-9_.-]/gi, "_") || "file"; }

function buildSam(name: string, caps: Capability[]): Record<string, unknown> {
  const sam: Record<string, unknown> = {};
  if (caps.includes("net")) {
    sam.fetch = async (url: string) => {
      if (!/^https?:\/\//i.test(String(url))) throw new Error("sam.fetch: only http(s) URLs");
      const r = await fetch(String(url), { signal: AbortSignal.timeout(10_000) });
      const buf = await r.arrayBuffer();
      if (buf.byteLength > NET_MAX_BYTES) throw new Error("sam.fetch: response too large");
      return new TextDecoder().decode(buf);
    };
  }
  if (caps.includes("fs:read")) {
    sam.readFile = async (file: string) => fsRead(join(toolSandboxDir(name), safeName(file)), "utf8").catch(() => "");
  }
  if (caps.includes("fs:write")) {
    sam.writeFile = async (file: string, content: string) => { await fsWrite(join(toolSandboxDir(name), safeName(file)), String(content ?? "").slice(0, NET_MAX_BYTES)); return "ok"; };
  }
  return sam;
}

// ── SANDBOX — locked-down vm context; only pure builtins + the declared sam.* shims. ──
export async function sandboxRun(code: string, input: any, caps: Capability[] = [], name = "forged"): Promise<string> {
  const ctx: any = {
    JSON, Math, Date, String, Number, Array, Object, RegExp, Boolean, Symbol,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
    sam: buildSam(name, caps),
  };
  vm.createContext(ctx, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`"use strict"; this.__f = (${code});`, ctx, { timeout: SANDBOX_TIMEOUT_MS });
  if (typeof ctx.__f !== "function") throw new Error("not a function");
  const call = Promise.resolve(ctx.__f(input, ctx.sam));   // sync body is bounded above; async is bounded below
  const out = await Promise.race([
    call,
    new Promise((_r, rej) => setTimeout(() => rej(new Error("sandbox timeout")), CALL_TIMEOUT_MS)),
  ]);
  return String(out ?? "");
}

export async function testForged(code: string, tests: { input: any }[], caps: Capability[] = [], name = "forged"): Promise<{ ok: boolean; error?: string; samples: { input: any; output: string }[] }> {
  const samples: { input: any; output: string }[] = [];
  try {
    // Only run pure/fs tools during the test (a `net` draft isn't hit for real at forge time).
    if (caps.includes("net")) return { ok: true, samples: [{ input: "(skipped)", output: "net tool — not executed at forge time" }] };
    for (const t of (tests.length ? tests : [{ input: "" }])) samples.push({ input: t.input, output: await sandboxRun(code, t.input, caps, name) });
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
      .map((f) => { try { const t = JSON.parse(readFileSync(join(FORGE_DIR, f), "utf8")); t.caps = Array.isArray(t.caps) ? t.caps : []; return t; } catch { return null; } })
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

// ── DRAFT ─────────────────────────────────────────────────────
const DRAFT_SYSTEM =
  "You write ONE small JavaScript tool for an assistant. It's a function `(input, sam) => string` (may be async). " +
  "PURE by default — plain JS only (String, Number, Array, Object, Math, JSON, Date, RegExp). " +
  "If (and ONLY if) the task needs it, you may use capability shims and DECLARE them: `sam.fetch(url)` needs `net`; " +
  "`sam.readFile(name)`/`sam.writeFile(name,content)` (sandboxed files) need `fs:read`/`fs:write`. " +
  "NEVER use eval/Function/require/import/process/child_process/shell/bare fetch/bare fs — those are forbidden. " +
  "Return STRICT JSON: {\"name\":\"snake_case\",\"description\":\"...\",\"params\":\"{...}\",\"explanation\":\"one sentence\",\"caps\":[],\"code\":\"(input, sam) => {...}\",\"tests\":[{\"input\":...}]}. JSON only.";

export interface DraftResult { ok: boolean; tool?: ForgedTool; reason?: string; samples?: { input: any; output: string }[] }

export async function forgeTool(need: string): Promise<DraftResult> {
  const r = await runModel("free", DRAFT_SYSTEM, `Build a tool for this need: ${need}\n\nReturn ONLY the JSON.`, "code");
  let spec: any;
  try { spec = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] || r.text); }
  catch { return { ok: false, reason: "The draft wasn't valid JSON — try rephrasing the need." }; }

  const name = String(spec?.name || "").toLowerCase().trim();
  const code = String(spec?.code || "");
  const caps: Capability[] = Array.isArray(spec?.caps) ? spec.caps.filter((c: any): c is Capability => ALL_CAPS.includes(c)) : [];
  if (!NAME_RE.test(name)) return { ok: false, reason: "Bad tool name (need snake_case, 3-40 chars)." };
  if (TOOLS.some((t) => t.name === name)) return { ok: false, reason: `A tool named "${name}" already exists.` };
  if (!/=>|function/.test(code)) return { ok: false, reason: "The draft wasn't a function." };

  const scan = scanCode(code, caps);
  if (!scan.ok) return { ok: false, reason: `Refused — the draft is unsafe (${scan.violations.join("; ")}).` };

  const tests = Array.isArray(spec?.tests) ? spec.tests.slice(0, 5) : [];
  const test = await testForged(code, tests, caps, name);
  if (!test.ok) return { ok: false, reason: `The draft failed its sandbox test: ${test.error}` };

  const tool: ForgedTool = {
    name, code, caps,
    description: String(spec?.description || need).slice(0, 200),
    params: String(spec?.params || "input"),
    explanation: String(spec?.explanation || "").slice(0, 300),
    tests, enabled: false, createdAt: Date.now(), tier: tierForCaps(caps),
  };
  saveForged(tool);
  return { ok: true, tool, samples: test.samples };
}

// ── LIVE REGISTRY (hot-reload) ────────────────────────────────
export interface ForgedRuntimeTool extends Tool { forged?: true }
export function syncForgedRegistry(): number {
  // Drop previously-registered forged tools + clear their dynamic-dangerous marks, then re-add enabled.
  for (let i = TOOLS.length - 1; i >= 0; i--) {
    const t = TOOLS[i] as ForgedRuntimeTool;
    if (t.forged) { unmarkDangerous(t.name); TOOLS.splice(i, 1); }
  }
  let n = 0;
  for (const t of listForged()) {
    if (!t.enabled) continue;
    if (!scanCode(t.code, t.caps).ok) continue;   // defence-in-depth: never register code that fails the scan
    const tier = tierForCaps(t.caps);
    if (tier === "dangerous") markDangerous(t.name);   // net / fs:write forged tools are gated like any dangerous tool
    const capLabel = t.caps.length ? ` [${t.caps.join(", ")}]` : "";
    const rt: ForgedRuntimeTool = {
      name: t.name, safe: false, forged: true,          // forged ⇒ never safe
      description: `${t.description} (forged by SAM${capLabel})`,
      params: t.params,
      activity: () => `Running your forged tool ${t.name}`,
      preview: () => `Run the SAM-forged tool "${t.name}"${capLabel} — ${t.explanation}`,
      run: async (input: any) => { try { return await sandboxRun(t.code, input, t.caps, t.name); } catch (e: any) { return `forged tool errored: ${e?.message || e}`; } },
    };
    TOOLS.push(rt); n++;
  }
  return n;
}

export function forgedStats() {
  const all = listForged();
  return { total: all.length, enabled: all.filter((t) => t.enabled).length, dangerous: all.filter((t) => tierForCaps(t.caps) === "dangerous").length };
}
