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

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
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

// ── SANDBOX DIR — per-tool fs jail for fs:read / fs:write (no traversal, no wider disk). ──
function toolSandboxDir(name: string): string {
  const dir = join(FORGE_FS, name.replace(/[^a-z0-9_]/gi, "_"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

// ── THE ISOLATE ──────────────────────────────────────────────────────────────────────────────
// Node's `vm` is explicitly NOT a security boundary: injected/host objects leak the host `Function`
// constructor via `x.constructor.constructor("…")()`, which ignores vm codeGeneration flags → RCE.
// So forged code runs in a SEPARATE process started with `--disallow-code-generation-from-strings`,
// which disables eval/Function isolate-wide. There, the constructor-chain escape can generate no code
// and throws — real containment. The child also gets a STRIPPED env (no API keys reach it) and only
// the sam.* shims for capabilities the tool declared. Nothing ambient (process/require/fetch/fs) is
// reachable: the user fn is invoked with `this` bound to a null-proto object and a bare vm context.
const HARNESS = `
const vm = require("node:vm");
const { readFileSync, writeFileSync, mkdirSync, existsSync } = require("node:fs");
const { join, basename } = require("node:path");
const NET_MAX = ${NET_MAX_BYTES};
const safeName = (p) => (basename(String(p || "")).replace(/[^a-z0-9_.-]/gi, "_")) || "file";
let raw = ""; process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { raw += d; });
process.stdin.on("end", async () => {
  let res;
  try {
    const { code, input, caps, dir } = JSON.parse(raw);
    const sam = {};
    if (caps.includes("net")) sam.fetch = async (url) => {
      if (!/^https?:\\/\\//i.test(String(url))) throw new Error("sam.fetch: only http(s) URLs");
      const r = await fetch(String(url), { signal: AbortSignal.timeout(10000) });
      const buf = await r.arrayBuffer();
      if (buf.byteLength > NET_MAX) throw new Error("sam.fetch: response too large");
      return new TextDecoder().decode(buf);
    };
    if (caps.includes("fs:read")) sam.readFile = async (f) => { try { return readFileSync(join(dir, safeName(f)), "utf8"); } catch { return ""; } };
    if (caps.includes("fs:write")) sam.writeFile = async (f, c) => { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, safeName(f)), String(c == null ? "" : c).slice(0, NET_MAX)); return "ok"; };
    const ctx = vm.createContext({}, { codeGeneration: { strings: false, wasm: false } });
    const fn = vm.runInContext("(function(){ return (" + code + "); }).call(Object.create(null))", ctx, { timeout: ${SANDBOX_TIMEOUT_MS} });
    if (typeof fn !== "function") throw new Error("not a function");
    const out = await Promise.race([
      Promise.resolve(fn(input, sam)),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("sandbox timeout")), ${CALL_TIMEOUT_MS})),
    ]);
    res = { ok: true, out: String(out == null ? "" : out) };
  } catch (e) { res = { ok: false, err: String((e && e.message) || e) }; }
  try { process.stdout.write(JSON.stringify(res)); } catch { process.stdout.write('{"ok":false,"err":"unserializable result"}'); }
  process.exit(0);
});
`;

// Run forged `code` in the codegen-disabled child. Resolves the tool's string output; REJECTS if the
// tool threw or the sandbox failed (callers wrap this — a failure never crashes the agent loop).
export function sandboxRun(code: string, input: any, caps: Capability[] = [], name = "forged"): Promise<string> {
  const dir = caps.includes("fs:read") || caps.includes("fs:write") ? toolSandboxDir(name) : "";
  const payload = JSON.stringify({ code, input, caps, dir });
  return new Promise<string>((resolve, reject) => {
    // ELECTRON_RUN_AS_NODE makes process.execPath run as node inside the packaged Electron app;
    // it's a harmless no-op under plain node. Env is otherwise EMPTY so no secret reaches the child.
    const child = spawn(process.execPath, ["--disallow-code-generation-from-strings", "-e", HARNESS], {
      env: { ELECTRON_RUN_AS_NODE: "1" }, stdio: ["pipe", "pipe", "ignore"],
    });
    let out = ""; let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill("SIGKILL"); } catch {} fn(); };
    const timer = setTimeout(() => done(() => reject(new Error("sandbox timeout"))), CALL_TIMEOUT_MS + 2000);
    child.stdout.on("data", (d) => { out += d; if (out.length > 2_000_000) done(() => reject(new Error("sandbox output too large"))); });
    child.on("error", (e: any) => done(() => reject(new Error(String(e?.message || e)))));
    child.on("close", () => done(() => {
      let r: any; try { r = JSON.parse(out); } catch { r = null; }
      if (r && r.ok) resolve(String(r.out ?? ""));
      else reject(new Error(r?.err || "sandbox produced no output"));
    }));
    child.stdin.on("error", () => {});   // child may exit before we finish writing
    child.stdin.write(payload); child.stdin.end();
  });
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
