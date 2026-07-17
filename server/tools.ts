// ─────────────────────────────────────────────────────────────
//  S.A.M. · TOOLS  (THE HANDS)
//  Every real-world action SAM can take. Each tool declares
//  whether it's `safe` (runs automatically) or risky (needs
//  the user's OK first — the ask-first safety gate).
//
//  100% local / free: uses macOS built-ins (osascript, System
//  Events, screencapture, open) + Node + fetch. No paid APIs.
// ─────────────────────────────────────────────────────────────

import { exec, execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, stat, appendFile as appendFileFs, rename, cp } from "node:fs/promises";
import { existsSync, readdirSync, mkdirSync } from "node:fs";

// ── Cross-platform file search (NO shell) — works on Windows/Linux/Mac identically. Mac keeps its
//    fast Spotlight `mdfind` path where called; this is the portable fallback. Walk is bounded so it
//    can't run away on a huge tree, and skips hidden/system/heavy dirs. ──────────────────────────
const SKIP_DIRS = new Set(["node_modules", "Library", ".git", ".Trash", "vendor", "dist", "build", ".cache"]);
async function walkFiles(dir: string, depth: number, out: string[]): Promise<string[]> {
  if (depth < 0 || out.length >= 4000) return out;
  let entries: any[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (out.length >= 4000) break;
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walkFiles(full, depth - 1, out);
    else out.push(full);
  }
  return out;
}
async function findByName(root: string, query: string, limit = 30): Promise<string[]> {
  const q = query.toLowerCase();
  return (await walkFiles(root, 5, [])).filter((f) => basename(f).toLowerCase().includes(q)).slice(0, limit);
}
async function findByContent(root: string, query: string, limit = 30): Promise<string[]> {
  const q = query.toLowerCase(); const hits: string[] = [];
  for (const f of await walkFiles(root, 4, [])) {
    if (hits.length >= limit) break;
    if (!/\.(txt|md|markdown|json|jsonl|js|ts|tsx|csv|log|html?|xml|ya?ml|py|env|conf|ini|rtf)$/i.test(f)) continue;
    try { if ((await readFile(f, "utf8")).toLowerCase().includes(q)) hits.push(f); } catch {}
  }
  return hits;
}
import { homedir, } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { resolve, dirname, basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Heavy CJS/native deps (pdf-parse, mammoth, playwright) are lazy-loaded at call
// time via require — importing them as ESM at the top crashed boot, and this also
// keeps startup fast/slim (they only load if you actually use them).
const require = createRequire(import.meta.url);
import type { Page } from "playwright-core";
import { hasJina, jinaSearch, jinaRead } from "./jina.ts";
import { fetchLocation, nowText } from "./context.ts";
import { grabRepos, loadSocials } from "./world.ts";
import { logSecurity, securityStatus } from "./security.ts";
import { addNudge, listNudges, completeNudge } from "./proactive.ts";
import { addPerson, listPeople } from "./people.ts";
import { remember, recall, listRecent, forget, clearAll } from "./memory.ts";
import { ingestFolder, reportText, searchDocs, docsStats, recentDocs, forgetDoc } from "./ingest.ts";
import { addFolder, removeFolder, listFolders, askAbout, lifeIndexStats } from "./lifeindex.ts";
import { forgeTool, listForged, forgedStats } from "./forge.ts";
import { addSchedule, listSchedules, removeSchedule, toggleSchedule } from "./scheduler.ts";
import { startSwarm, loadSwarms, stopSwarm } from "./swarm.ts";
import { listAllowed, allow, disallow, setAutopilot, autopilotOn, isElonMode } from "./authz.ts";
import { PROJECTS } from "./projects.ts";
import { keyStatus, getKey, poolSize, reportSuccess, reportFailure } from "./keys.ts";
import { capacityReport, capacityNudge } from "./capacity.ts";
import { sendMail, mailerConfigured, ownerEmail } from "./mailer.ts";
import { runSelftest } from "./selftest.ts";
import { loadSkills } from "./skills.ts";
import { vaultStats, recentLog, pruneOldLogs } from "./vault.ts";
import { runVision, runModel } from "./models.ts";
import * as nb from "./notebook.ts";
import { retrieveFullOutput } from "./compress.ts";
const VAULT_DIR = process.env.VAULT_DIR || join(dirname(fileURLToPath(new URL(import.meta.url))), "..", "vault");
import { extractFactsFromTranscript, saveImportedFacts } from "./importer.ts";

// Locate the user's Obsidian vault: explicit OBSIDIAN_VAULT, else the usual spots (a real
// Obsidian vault always contains a `.obsidian` config folder — that's how we recognise one).
function obsidianVault(): string | null {
  const home = homedir();
  const explicit = process.env.OBSIDIAN_VAULT;
  if (explicit && existsSync(explicit.replace(/^~/, home))) return explicit.replace(/^~/, home);
  const candidates = [
    join(home, "Obsidian"), join(home, "Documents", "Obsidian"), join(home, "Documents"),
    join(home, "Library", "Mobile Documents", "iCloud~md~obsidian", "Documents"),
  ];
  for (const base of candidates) {
    try {
      if (existsSync(join(base, ".obsidian"))) return base;
      for (const sub of readdirSync(base, { withFileTypes: true })) {   // a vault nested one level down
        if (sub.isDirectory() && existsSync(join(base, sub.name, ".obsidian"))) return join(base, sub.name);
      }
    } catch { /* not there */ }
  }
  return null;
}

const sh = promisify(exec);
// No-shell exec for anything carrying model/user text — args go straight to the
// binary, so $(…)/backticks/quotes can never reach a shell.
const execFile = promisify(execFileCb);

// Shell-safe single-quote wrapping for untrusted args.
const shq = (s: any) => `'${String(s ?? "").replace(/'/g, "'\\''")}'`;

// GitHub via the gh CLI (already logged in on this Mac — no tokens to manage).
async function gh(args: string): Promise<string> {
  try {
    const { stdout } = await sh(`gh ${args}`, { timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
    return (stdout.trim() || "(done)").slice(0, 6000);
  } catch (e: any) {
    const msg = (e?.stderr || e?.message || e).toString();
    if (/not logged|authentication|gh auth/i.test(msg)) return "GitHub isn't logged in. Run `gh auth login` in Terminal first.";
    if (/command not found|not found: gh/i.test(msg)) return "The GitHub CLI (gh) isn't installed. Install it with `brew install gh`.";
    return `GitHub: ${msg.slice(0, 300)}`;
  }
}

// git in a specific local repo folder (handles spaces in the path).
async function gitIn(dir: string, args: string): Promise<string> {
  try {
    const { stdout, stderr } = await sh(`git -C ${shq(dir)} ${args}`, { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    return ((stdout || "") + (stderr || "")).trim().slice(0, 4000) || "(done)";
  } catch (e: any) {
    return `git: ${(e?.stderr || e?.message || e).toString().slice(0, 400)}`;
  }
}
async function currentBranch(dir: string): Promise<string> {
  return (await gitIn(dir, "rev-parse --abbrev-ref HEAD")).trim();
}

// ── Portability: works on any laptop; Mac-only tools degrade gracefully.
export const OS = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux";
const IS_MAC = OS === "mac";
function notSupported(feature: string): string {
  return `“${feature}” is not currently supported natively on ${OS}.`;
}
// Cross-platform "open this URL/app/file with the system default".
function openCmd(target: string): string {
  if (OS === "mac") return `open ${shq(target)}`;
  if (OS === "windows") return `start "" ${shq(target)}`;
  return `xdg-open ${shq(target)}`;
}

export interface Tool {
  name: string;
  safe: boolean;                 // true = auto-run, false = ask the user first
  description: string;           // shown to the model
  params: string;               // human/model hint for the input shape
  activity: (input: any) => string;   // plain-language "what SAM is doing"
  preview?: (input: any) => string;   // what the confirm card shows (risky only)
  run: (input: any) => Promise<string>;
}

// Never run these, even if approved — catastrophic / irreversible. Tuned to block the
// truly unrecoverable forms (wiping ~, /, a whole system root or a mounted volume ROOT)
// WITHOUT blocking legitimate cleanup inside those trees (e.g. rm -rf /Volumes/DRIVE/proj/dist).
// Destructive verbs are anchored to command position so they don't false-positive on
// read-only uses like `grep shutdown log` or `ls /bin/rm`.
const HARD_DENY = [
  /\brm\s+(?:-[a-z]+\s+)*["']?[~/]\/?["']?\s*(?:$|[\s;])/i,                               // rm [flags] ~  |  /  (root/home wipe; ReDoS-safe — each flag group anchored by '-')
  /\brm\s+(?:-[a-z]+\s+)*["']?(?:\$\{?HOME\}?|\/(?:Users|System|Library|Applications|Volumes))\/?["']?(?:\s|;|$)/i,  // rm of $HOME or a system / all-volumes ROOT (NOT subdirs — a specific drive/dir is approval-gated)
  /(^|[;&|]\s*)(sudo\s+)?\/(usr\/)?bin\/rm\s+(-[a-z]*[rf])/i,                             // absolute rm -rf as a command (sidesteps trash alias)
  /\bfind\s+["']?[~/]["']?(\s|$).*(-delete|-exec\s+rm)/i,
  /\bmkfs\b/, /\bdd\s+(if|of)=/, /:\(\)\s*\{/,
  /(^|[;&|]\s*)(sudo\s+)?(shutdown|reboot|halt)\b/i, /\bkillall\s+-9\b/, />\s*\/dev\/(sd|disk|rdisk)/,
  /\bchmod\s+-R\s+000\b/, /\bsudo\s+(rm|dd|mkfs|chmod|chown|shutdown|reboot)\b/,
  /\bdiskutil\s+(erase|partition|apfs\s+delete)/i, /\bcsrutil\b/, /\blaunchctl\s+bootout\b/,
];
// Pure predicate (no logging) — exported so the denylist can be unit-tested without
// executing anything (you can't test an "allowed" command by running rm).
export function isCatastrophic(cmd: string): boolean {
  return HARD_DENY.some((re) => re.test(cmd));
}
function denied(cmd: string): string | null {
  if (isCatastrophic(cmd)) {
    logSecurity("alert", "blocked-command", `Refused a catastrophic command: ${cmd}`, "agent");
    return `Blocked for safety: "${cmd}" matches a catastrophic-command guard. SAM will never run this.`;
  }
  return null;
}

const clip = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + `\n…[trimmed, ${s.length} chars total]` : s);
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// ── INTERNET ─────────────────────────────────────────────────
// Outbound requests get a hard timeout (free providers stall) and web_fetch —
// which auto-runs on a model-chosen URL — gets an SSRF guard so internal/LAN
// targets (router admin, cloud metadata, localhost services) are unreachable.
const WEB_TIMEOUT = 15000;
const webSignal = () => AbortSignal.timeout(WEB_TIMEOUT);
// Every outbound fetch in this file goes through tfetch so a stalled public API
// (weather, translate, finance, HN…) can't hang the agent loop forever. Node's
// fetch has NO default timeout. Callers may pass their own signal (kept as-is).
function tfetch(url: any, opts: any = {}): Promise<Response> {
  return fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(WEB_TIMEOUT) });
}
export function isPrivateIp(ip: string): boolean {
  const h = ip.toLowerCase();
  if (h === "::" || h === "::1") return true;                        // unspecified / v6 loopback
  if (/^f[cd]|^fe80:/.test(h)) return true;                          // v6 ULA / link-local
  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1) — unwrap to the v4 and re-check,
  // otherwise a mapped loopback slips past the guard and web_fetch hits localhost.
  const mapped = h.match(/^::ffff:(.+)$/i);
  if (mapped) {
    const hex = mapped[1].match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    const v4 = hex
      ? `${(parseInt(hex[1], 16) >> 8) & 255}.${parseInt(hex[1], 16) & 255}.${(parseInt(hex[2], 16) >> 8) & 255}.${parseInt(hex[2], 16) & 255}`
      : mapped[1];
    return isPrivateIp(v4);
  }
  const m = ip.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
async function assertPublicUrl(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.lan)$/i.test(host)) throw new Error(`blocked: ${host} is an internal address`);
  if (isPrivateIp(host)) throw new Error(`blocked: ${host} is a private address`);
  try {
    const { lookup } = await import("node:dns/promises");
    const addrs = await lookup(host, { all: true });
    if (addrs.some((a) => isPrivateIp(a.address))) throw new Error(`blocked: ${host} resolves to a private address`);
  } catch (e: any) {
    if (String(e?.message).startsWith("blocked")) throw e;           // DNS failure itself → let fetch report it
  }
}

// Prefers Jina (clean, reliable) when a key is set; falls back to a
// free DuckDuckGo scrape so the web always works.
async function webSearch(q: string): Promise<string> {
  if (hasJina()) {
    try { return clip(await jinaSearch(q), 1800); } catch { /* fall back */ }   // tight — keeps the whole loop under free-tier token limits
  }
  const r = await tfetch("https://duckduckgo.com/html/?q=" + encodeURIComponent(q), {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" }, signal: webSignal(),
  });
  const html = await r.text();
  const out: string[] = [];
  const re = /<a[^>]*class="result__a"[^>]*>(.*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 6) {
    const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
    out.push(`• ${strip(m[1])} — ${strip(m[2])}`);
  }
  return out.length ? out.join("\n") : "No results parsed. Try web_fetch on a specific URL instead.";
}

async function webFetch(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  await assertPublicUrl(url);
  if (hasJina()) {
    try { return clip(await jinaRead(url), 5000); } catch { /* fall back */ }
  }
  const r = await tfetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" }, signal: webSignal() });
  const html = await r.text();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
  return clip(text);
}

// ── TERMINAL ─────────────────────────────────────────────────
async function runCommand(cmd: string): Promise<string> {
  const d = denied(cmd);
  if (d) return d;
  try {
    let finalCmd = cmd;
    if (isElonMode()) {
      // 30-day safety bin: intercept `rm` in Elon Mode to prevent catastrophic data loss.
      // Moves targeted files/folders to ~/.sam-trash with a timestamp instead of deleting.
      const trashAlias = `rm() { mkdir -p ~/.sam-trash; for arg in "$@"; do case "$arg" in -*) ;; *) mv "$arg" ~/.sam-trash/"$(basename "$arg")-$(date +%s)" 2>/dev/null || true ;; esac; done; }; `;
      finalCmd = trashAlias + cmd;
    }
    const { stdout, stderr } = await sh(finalCmd, { timeout: 60000, cwd: homedir(), maxBuffer: 8 * 1024 * 1024 });
    return clip((stdout || "") + (stderr ? `\n[stderr] ${stderr}` : "")) || "(command finished, no output)";
  } catch (e: any) {
    return `Command failed: ${e?.message || e}`.slice(0, 2000);
  }
}

// ── FILES ────────────────────────────────────────────────────
const safePath = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));
async function readFileTool(path: string): Promise<string> {
  try {
    const sp = safePath(path);
    const ext = extname(sp).toLowerCase();
    
    if (ext === ".pdf") {
      const pdfParse = require("pdf-parse");
      const data = await readFile(sp);
      const res = await pdfParse(data);
      return clip(res.text);
    }

    if (ext === ".docx") {
      const mammoth = require("mammoth");
      const data = await readFile(sp);
      const res = await mammoth.extractRawText({ buffer: data });
      return clip(res.value);
    }

    return clip(await readFile(sp, "utf8")); 
  } catch (e: any) { 
    return `Could not read ${path}: ${e?.message}`; 
  }
}
async function writeFileTool(input: { path: string; content: string }): Promise<string> {
  try { await writeFile(safePath(input.path), input.content, "utf8"); return `Wrote ${input.content.length} chars to ${input.path}`; }
  catch (e: any) { return `Could not write ${input.path}: ${e?.message}`; }
}
async function listDir(path: string): Promise<string> {
  try {
    const dir = safePath(path || "~");
    const items = await readdir(dir);
    const rows = await Promise.all(items.slice(0, 200).map(async (n) => {
      try { const s = await stat(resolve(dir, n)); return `${s.isDirectory() ? "📁" : "📄"} ${n}`; } catch { return `   ${n}`; }
    }));
    return rows.join("\n") || "(empty)";
  } catch (e: any) { return `Could not list ${path}: ${e?.message}`; }
}
// Human-readable byte size (portable, no deps) — 1234 → "1.2 KB".
function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes, u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${u === 0 ? n : n.toFixed(1)} ${units[u]}`;
}
// folder_digest — walk a folder (bounded) and summarise it: file count, total size, top file
// types, and the biggest files. Read-only, cross-platform, skips heavy/system dirs like the search
// walk above. Scan is capped so it can't run away on a giant tree.
async function folderDigest(path: string): Promise<string> {
  const CAP = 5000;   // max files scanned before we stop and say so
  try {
    const root = safePath(path || "~");
    const st = await stat(root).catch(() => null);
    if (!st) return `Could not read ${path}: no such folder (or no permission).`;
    if (!st.isDirectory()) return `${path} is a file, not a folder — try read_file instead.`;

    let scanned = 0, totalBytes = 0, capped = false;
    const byExt = new Map<string, { count: number; bytes: number }>();
    const biggest: { name: string; bytes: number }[] = [];   // kept sorted desc, top 5

    // Iterative BFS so we don't blow the stack on deep trees; bounded by CAP.
    const queue = [root];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: any[];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (scanned >= CAP) { capped = true; break; }
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { queue.push(full); continue; }
        let s: any;
        try { s = await stat(full); } catch { continue; }
        scanned++;
        totalBytes += s.size;
        const ext = (extname(e.name).toLowerCase() || "(no ext)").replace(/^\./, "");
        const cur = byExt.get(ext) || { count: 0, bytes: 0 };
        cur.count++; cur.bytes += s.size; byExt.set(ext, cur);
        if (biggest.length < 5 || s.size > biggest[biggest.length - 1].bytes) {
          biggest.push({ name: full.replace(homedir(), "~"), bytes: s.size });
          biggest.sort((a, b) => b.bytes - a.bytes);
          if (biggest.length > 5) biggest.pop();
        }
      }
      if (capped) break;
    }

    if (scanned === 0) return `📂 ${path} — empty (no readable files).`;

    const topExts = [...byExt.entries()]
      .sort((a, b) => b[1].count - a[1].count).slice(0, 8)
      .map(([ext, v]) => `  • ${ext} — ${v.count} file${v.count === 1 ? "" : "s"} (${humanSize(v.bytes)})`)
      .join("\n");
    const bigList = biggest.map((b) => `  • ${basename(b.name)} — ${humanSize(b.bytes)}`).join("\n");

    return [
      `📂 Digest of ${path}`,
      `Files: ${scanned}${capped ? ` (scan capped at ${CAP} — folder is larger)` : ""}   ·   Total size: ${humanSize(totalBytes)}`,
      ``,
      `By type:`,
      topExts,
      ``,
      `Largest files:`,
      bigList,
    ].join("\n");
  } catch (e: any) { return `Could not digest ${path}: ${e?.message}`; }
}

// find_duplicates — walk a folder (bounded) and find files with identical contents so the user can
// reclaim space. Read-only, cross-platform, skips heavy/system dirs like the walks above. Efficient:
// group candidates by SIZE first, then only hash (SHA-256) files whose size collides — never hash
// everything. Reports the biggest duplicate groups and total reclaimable space. Scan is capped.
async function findDuplicates(path: string): Promise<string> {
  const CAP = 5000;   // max files scanned before we stop and say so
  try {
    const root = safePath(path || "~");
    const st = await stat(root).catch(() => null);
    if (!st) return `Could not read ${path}: no such folder (or no permission).`;
    if (!st.isDirectory()) return `${path} is a file, not a folder — try folder_digest instead.`;

    // Pass 1 — group files by size (cheap). Only sizes shared by 2+ files can hold duplicates.
    let scanned = 0, capped = false;
    const bySize = new Map<number, string[]>();
    const queue = [root];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: any[];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (scanned >= CAP) { capped = true; break; }
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { queue.push(full); continue; }
        let s: any;
        try { s = await stat(full); } catch { continue; }
        scanned++;
        if (s.size === 0) continue;   // ignore empty files — never worth reporting
        const cur = bySize.get(s.size) || [];
        cur.push(full); bySize.set(s.size, cur);
      }
      if (capped) break;
    }

    if (scanned === 0) return `📂 ${path} — empty (no readable files).`;

    // Pass 2 — for each colliding size, hash the contents and group truly-identical files.
    const groups: { size: number; files: string[] }[] = [];
    for (const [size, files] of bySize) {
      if (files.length < 2) continue;   // unique size → can't be a duplicate, skip hashing
      const byHash = new Map<string, string[]>();
      for (const f of files) {
        let hash: string;
        try { hash = createHash("sha256").update(await readFile(f)).digest("hex"); } catch { continue; }
        const cur = byHash.get(hash) || [];
        cur.push(f); byHash.set(hash, cur);
      }
      for (const dups of byHash.values()) {
        if (dups.length >= 2) groups.push({ size, files: dups });
      }
    }

    if (groups.length === 0) {
      return `✅ ${path} — no duplicate files found among ${scanned} scanned${capped ? ` (scan capped at ${CAP})` : ""}.`;
    }

    // Reclaimable space = every copy beyond the first, across all groups.
    let reclaimable = 0, dupCount = 0;
    for (const g of groups) { reclaimable += g.size * (g.files.length - 1); dupCount += g.files.length - 1; }
    groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));

    const top = groups.slice(0, 5).map((g) => {
      const names = g.files.slice(0, 4).map((f) => `    ${f.replace(homedir(), "~")}`).join("\n");
      const more = g.files.length > 4 ? `\n    …and ${g.files.length - 4} more` : "";
      return `  • ${g.files.length} copies × ${humanSize(g.size)} (reclaim ${humanSize(g.size * (g.files.length - 1))}):\n${names}${more}`;
    }).join("\n");

    return [
      `📂 Duplicates in ${path}`,
      `Found ${groups.length} duplicate group${groups.length === 1 ? "" : "s"} · ${dupCount} redundant file${dupCount === 1 ? "" : "s"} · reclaimable ${humanSize(reclaimable)}`,
      `(scanned ${scanned}${capped ? `, capped at ${CAP} — folder is larger` : ""})`,
      ``,
      `Top groups:`,
      top,
    ].join("\n");
  } catch (e: any) { return `Could not scan ${path}: ${e?.message}`; }
}

// Friendly "how long ago" — 90_000ms → "2 min ago". Falls back to a plain date once it's
// more than a week old, so old files read cleanly instead of "413 days ago".
function relativeTime(then: number, now = Date.now()): string {
  const diff = Math.max(0, now - then);
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  if (day <= 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  return new Date(then).toISOString().slice(0, 10);   // YYYY-MM-DD for anything older
}

// recent_files — walk a folder (bounded) and list the most recently modified files, newest first, so
// the user can quickly find "what did I work on lately". Read-only, cross-platform, skips heavy/system
// dirs like the walks above. Scan is capped so it can't run away on a giant tree.
async function recentFiles(path: string, limit = 15): Promise<string> {
  const CAP = 5000;   // max files scanned before we stop and say so
  const n = Math.max(1, Math.min(100, Number(limit) || 15));
  try {
    const root = safePath(path || "~");
    const st = await stat(root).catch(() => null);
    if (!st) return `Could not read ${path}: no such folder (or no permission).`;
    if (!st.isDirectory()) return `${path} is a file, not a folder — try read_file instead.`;

    let scanned = 0, capped = false;
    const files: { name: string; mtime: number; bytes: number }[] = [];

    // Iterative BFS so we don't blow the stack on deep trees; bounded by CAP.
    const queue = [root];
    while (queue.length) {
      const dir = queue.shift()!;
      let entries: any[];
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (scanned >= CAP) { capped = true; break; }
        if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) { queue.push(full); continue; }
        let s: any;
        try { s = await stat(full); } catch { continue; }
        scanned++;
        files.push({ name: full.replace(homedir(), "~"), mtime: s.mtimeMs, bytes: s.size });
      }
      if (capped) break;
    }

    if (scanned === 0) return `📂 ${path} — empty (no readable files).`;

    files.sort((a, b) => b.mtime - a.mtime);   // most recently modified first
    const top = files.slice(0, n)
      .map((f) => `· ${f.name} — ${relativeTime(f.mtime)}, ${humanSize(f.bytes)}`)
      .join("\n");

    return [
      `🕒 Recent files in ${path}`,
      `Showing ${Math.min(n, files.length)} of ${scanned}${capped ? ` (scan capped at ${CAP} — folder is larger)` : ""}, newest first:`,
      ``,
      top,
    ].join("\n");
  } catch (e: any) { return `Could not scan ${path}: ${e?.message}`; }
}

// ── macOS CONTROL · mouse / keyboard / apps / screen ─────────
async function osa(script: string): Promise<string> {
  // Graceful cross-platform degrade: the model reads this and tells the user honestly
  // (instead of a cryptic failure), usually offering the nearest thing it CAN do here.
  if (!IS_MAC) throw new Error(`this action needs macOS — this machine runs ${OS}, so tell the user it isn't available here`);
  const { stdout } = await execFile("osascript", ["-e", script], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim();
}
async function openApp(name: string): Promise<string> {
  if (IS_MAC) await execFile("open", ["-a", name]);
  else if (OS === "windows") await sh(`start "" ${shq(name)}`);
  else await sh(`${shq(name)} &`).catch(() => {});
  return `Opened ${name}.`;
}
async function typeText(text: string): Promise<string> {
  if (IS_MAC) {
    await osa(`tell application "System Events" to keystroke "${esc(text)}"`);
  } else if (OS === "windows") {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${text.replace(/'/g, "''")}');`;
    await execFile("powershell", ["-command", ps]);   // execFile (no shell) — no cmd.exe quote break-out
  } else {
    await sh(`xdotool type ${shq(text)}`);
  }
  return `Typed: ${text}`;
}
async function pressKey(input: { key: string; modifiers?: string[] }): Promise<string> {
  if (IS_MAC) {
    const mods = (input.modifiers || []).filter((m) => ["command", "shift", "option", "control"].includes(m)).map((m) => `${m} down`).join(", ");
    const using = mods ? ` using {${mods}}` : "";
    await osa(`tell application "System Events" to key code ${Number(input.key) | 0}${using}`);
    return `Pressed key ${input.key}${using}`;
  } else if (OS === "windows") {
    // Basic fallback for Windows using SendKeys. Key codes map differently.
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('{${String(input.key).replace(/'/g, "''")}}');`;
    await execFile("powershell", ["-command", ps]);
    return `Pressed key ${input.key}`;
  } else {
    await sh(`xdotool key ${shq(input.key)}`);
    return `Pressed key ${input.key}`;
  }
}
async function clickAt(input: { x: number; y: number }): Promise<string> {
  if (IS_MAC) {
    await osa(`tell application "System Events" to click at {${Number(input.x) | 0}, ${Number(input.y) | 0}}`);
  } else if (OS === "windows") {
    const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Number(input.x) | 0}, ${Number(input.y) | 0}); Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int buttons, int extrainfo);' -Name Mouse -Namespace Win32; [Win32.Mouse]::mouse_event(0x0002 -bor 0x0004, 0, 0, 0, 0);`;
    await execFile("powershell", ["-command", ps]);
  } else {
    await sh(`xdotool mousemove ${Number(input.x)|0} ${Number(input.y)|0} click 1`);
  }
  return `Clicked at ${input.x},${input.y}`;
}
async function appleScript(script: string): Promise<string> {
  const s = String(script ?? "");
  // Defence-in-depth: AppleScript can `do shell script "…"`, which bypasses run_command's
  // guard entirely. Run the source through the same catastrophic-command check so a smuggled
  // `rm -rf ~` (etc.) is refused even if this tool was approved or always-allowed.
  const d = denied(s);
  if (d) return d;
  try { return (await osa(s)) || "(AppleScript ran, no output)"; }
  catch (e: any) { return `AppleScript failed: ${e?.message}`; }
}
async function screenshot(): Promise<string> {
  const path = resolve(homedir(), "Desktop", `SAM-screenshot-${Date.now()}.png`);
  try {
    if (IS_MAC) {
      await sh(`screencapture -x ${shq(path)}`);
    } else if (OS === "windows") {
      const ps = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height; $gfx = [System.Drawing.Graphics]::FromImage($bmp); $gfx.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size); $bmp.Save('${path}', [System.Drawing.Imaging.ImageFormat]::Png); $gfx.Dispose(); $bmp.Dispose()`;
      await sh(`powershell -command "${ps}"`);
    } else {
      await sh(`import -window root ${shq(path)} 2>/dev/null || scrot ${shq(path)}`);
    }
    return `Saved a screenshot to ${path}`;
  } catch (e: any) {
    return `Failed to take screenshot: ${e.message}`;
  }
}
async function clipboardGet(): Promise<string> {
  try {
    if (IS_MAC) { const { stdout } = await sh("pbpaste"); return clip(stdout, 4000); }
    if (OS === "windows") { const { stdout } = await sh("powershell -command Get-Clipboard"); return clip(stdout, 4000); }
    const { stdout } = await sh("xclip -selection clipboard -o"); return clip(stdout, 4000);
  } catch { return notSupported("read clipboard"); }
}
async function clipboardSet(text: string): Promise<string> {
  try {
    if (IS_MAC) await sh(`printf %s ${shq(text)} | pbcopy`);
    else if (OS === "windows") await sh(`echo ${shq(text)} | clip`);
    else await sh(`printf %s ${shq(text)} | xclip -selection clipboard`);
    return "Copied to clipboard.";
  } catch { return notSupported("set clipboard"); }
}
async function notify(input: { title?: string; message: string }): Promise<string> {
  const title = input.title || "SAM";
  const clean = input.message.replace(/[#*`]/g, "").slice(0, 220);
  // Quotes/angle-brackets are stripped, not escaped — they break the AppleScript/
  // PowerShell/XML string contexts differently and add nothing to a notification.
  const e = (s: string) => s.replace(/["'<>&\\]/g, "").replace(/\n/g, " ");
  if (IS_MAC) {
    await execFile("osascript", ["-e", `display notification "${e(clean)}" with title "${e(title.slice(0, 60))}"`]);
  } else if (OS === "windows") {
    const ps = `[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null; $t=[Windows.UI.Notifications.ToastNotification]::new([Windows.Data.Xml.Dom.XmlDocument]::new()); $x=$t.Content; $x.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">${e(title)}</text><text id="2">${e(clean)}</text></binding></visual></toast>'); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('SAM').Show($t)`;
    await execFile("powershell", ["-command", ps]);
  } else {
    await execFile("notify-send", [e(title), e(clean)]).catch(() => {});
  }
  return "Notification shown.";
}

// ── MORE INTERNET / INFO (safe) ──────────────────────────────
async function getWeather(place: string): Promise<string> {
  const r = await tfetch("https://wttr.in/" + encodeURIComponent(place || "") + "?format=%l:+%C+%t,+feels+%f,+wind+%w,+humidity+%h");
  return (await r.text()).trim() || "Couldn't get the weather.";
}
async function openUrl(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  await sh(openCmd(url)); return `Opened ${url} in your browser.`;
}
async function searchFiles(q: string): Promise<string> {
  try {
    // Mac: fast Spotlight index (name + content). Windows/Linux: Node-native walk (no shell), matching
    // by filename first, then by content — works identically everywhere, no grep/mdfind dependency.
    if (IS_MAC) { const { stdout } = await sh(`mdfind ${shq(q)} | head -30`, { timeout: 20000 }); const r = clip(stdout.trim()); if (r) return r; }
    const home = homedir();
    let hits = await findByName(home, q, 30);
    if (!hits.length) hits = await findByContent(home, q, 30);
    return hits.length ? clip(hits.join("\n")) : "No files found.";
  } catch (e: any) { return `Search failed: ${e?.message}`; }
}
async function systemInfo(): Promise<string> {
  try {
    const cmd = IS_MAC ? "sw_vers; echo; uptime; echo; df -h / | tail -1"
      : OS === "windows" ? "systeminfo | findstr /C:\"OS Name\" /C:\"System Boot Time\""
      : "uname -a; echo; uptime; echo; df -h / | tail -1";
    const { stdout } = await sh(cmd, { timeout: 10000 });
    return clip(stdout.trim());
  } catch (e: any) { return `Couldn't read system info: ${e?.message}`; }
}
async function getBattery(): Promise<string> {
  try {
    if (IS_MAC) { const { stdout } = await sh("pmset -g batt | tail -1"); return stdout.trim(); }
    if (OS === "windows") { const { stdout } = await sh("WMIC Path Win32_Battery Get EstimatedChargeRemaining"); return `Battery: ${stdout.replace(/[^0-9]/g, "")}%`; }
    const { stdout } = await sh("acpi -b 2>/dev/null || cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || echo 'battery info unavailable'");
    return stdout.trim();
  } catch { return "Battery info unavailable on this system."; }
}

async function speak(text: string): Promise<string> {
  if (!IS_MAC) return "SAM can speak in the browser instead (turn on 'Read replies aloud' in settings).";
  await sh(`say ${shq(text)}`); return `Said: ${text}`;
}

// ── MORE macOS ACTIONS (risky) ───────────────────────────────
async function _sendEmail(i: { to: string; subject?: string; body: string }): Promise<string> {
  const script = `tell application "Mail"
set m to make new outgoing message with properties {subject:"${esc(i.subject || "")}", content:"${esc(i.body)}", visible:false}
tell m to make new to recipient at end of to recipients with properties {address:"${esc(i.to)}"}
send m
end tell`;
  await osa(script); return `Email sent to ${i.to}.`;
}
async function sendIMessage(i: { to: string; message: string }): Promise<string> {
  const script = `tell application "Messages"
set targetService to 1st account whose service type = iMessage
set targetBuddy to participant "${esc(i.to)}" of targetService
send "${esc(i.message)}" to targetBuddy
end tell`;
  await osa(script); return `iMessage sent to ${i.to}.`;
}
async function _addReminder(i: { text: string; list?: string }): Promise<string> {
  const list = i.list ? `list "${esc(i.list)}"` : "default list";
  await osa(`tell application "Reminders" to make new reminder at ${list} with properties {name:"${esc(i.text)}"}`);
  return `Added reminder: ${i.text}`;
}
async function _addCalendarEvent(i: { title: string; start?: string; calendar?: string }): Promise<string> {
  const cal = i.calendar || "Home";
  const start = i.start ? `date "${esc(i.start)}"` : "(current date) + 3600";
  await osa(`tell application "Calendar" to tell calendar "${esc(cal)}" to make new event with properties {summary:"${esc(i.title)}", start date:${start}, end date:(${start}) + 3600}`);
  return `Added event: ${i.title}`;
}
async function appendFile(i: { path: string; content: string }): Promise<string> {
  try { const fs = await import("node:fs/promises"); await fs.appendFile(safePath(i.path), i.content, "utf8"); return `Appended to ${i.path}`; }
  catch (e: any) { return `Could not append: ${e?.message}`; }
}
async function moveToTrash(path: string): Promise<string> {
  // Trash (recoverable), never rm.
  await osa(`tell application "Finder" to delete POSIX file "${esc(safePath(path))}"`);
  return `Moved ${path} to the Trash (recoverable).`;
}
async function setVolume(level: number): Promise<string> {
  const v = Math.max(0, Math.min(100, Number(level)));
  await osa(`set volume output volume ${v}`); return `Volume set to ${v}%.`;
}
async function musicControl(action: string): Promise<string> {
  const a = String(action).toLowerCase();
  const cmd = a === "play" ? "play" : a === "pause" ? "pause" : a === "next" ? "next track" : a === "previous" || a === "prev" ? "previous track" : "playpause";
  await osa(`tell application "Music" to ${cmd}`); return `Music: ${a}`;
}
// Play/pull up a song, artist or playlist in the user's music service.
async function playMusic(query: string): Promise<string> {
  const svc = (process.env.MUSIC_SERVICE || "apple").toLowerCase();
  const q = encodeURIComponent(String(query).trim());
  const url = svc === "spotify" ? `https://open.spotify.com/search/${q}`
    : svc === "youtube" ? `https://music.youtube.com/search?q=${q}`
    : `https://music.apple.com/search?term=${q}`;
  await sh(openCmd(url));
  const label = svc === "spotify" ? "Spotify" : svc === "youtube" ? "YouTube Music" : "Apple Music";
  // On macOS + Apple Music, best-effort nudge playback to actually start.
  let nudged = false;
  if (IS_MAC && svc === "apple") { try { await osa(`tell application "Music" to play`); nudged = true; } catch { /* not installed / nothing queued */ } }
  // Report the TRUTH — we opened a search (and maybe nudged play). Never claim it's
  // definitely playing when we only opened a results page. No more tool calls.
  return `Opened "${query}" in ${label}${nudged ? " and started Music playing" : ` — tap the track to start it if it doesn't auto-play`}. Tell the user in one short line, with swagger but honestly. Do not call any more tools.`;
}

// ── CALLING (via iPhone Continuity — free) ───────────────────
async function makeCall(number: string): Promise<string> {
  if (!IS_MAC) return notSupported("phone calls");
  const n = String(number).replace(/[^\d+*#]/g, "");
  await sh(`open ${shq("tel://" + n)}`);
  return `Calling ${number} — pick up on your Mac or iPhone. (Needs 'Calls from iPhone' on in FaceTime settings.)`;
}
async function faceTime(who: string): Promise<string> {
  if (!IS_MAC) return notSupported("FaceTime");
  await sh(`open ${shq("facetime://" + who)}`);
  return `Starting a FaceTime with ${who}.`;
}

// ── READ PERSONAL DATA (safe, local — asks macOS permission once) ─
async function findContact(name: string): Promise<string> {
  try {
    const out = await osa(`set out to ""
tell application "Contacts"
  repeat with p in (people whose name contains "${esc(name)}")
    set out to out & (name of p)
    repeat with ph in phones of p
      set out to out & " · " & (value of ph)
    end repeat
    repeat with em in emails of p
      set out to out & " · " & (value of em)
    end repeat
    set out to out & linefeed
  end repeat
end tell
return out`);
    return out.trim() || `No contact found matching “${name}”.`;
  } catch (e: any) { return `Couldn't read Contacts: ${e?.message}`; }
}
async function readCalendar(): Promise<string> {
  try {
    const out = await osa(`set out to ""
set startD to (current date) - (time of (current date))
set endD to startD + 86400
tell application "Calendar"
  repeat with c in calendars
    repeat with e in (every event of c whose start date is greater than or equal to startD and start date is less than endD)
      set out to out & (time string of (start date of e)) & "  " & (summary of e) & linefeed
    end repeat
  end repeat
end tell
return out`);
    return out.trim() || "Nothing on your calendar today.";
  } catch (e: any) { return `Couldn't read Calendar: ${e?.message}`; }
}
async function readReminders(): Promise<string> {
  try {
    const out = await osa(`set out to ""
tell application "Reminders"
  repeat with r in (reminders whose completed is false)
    set out to out & (name of r) & linefeed
  end repeat
end tell
return out`);
    return clip(out.trim()) || "No open reminders.";
  } catch (e: any) { return `Couldn't read Reminders: ${e?.message}`; }
}
async function readEmails(): Promise<string> {
  try {
    const out = await osa(`tell application "Mail"
  set out to ""
  set unreadMsgs to (messages of inbox whose read status is false)
  set msgCount to count of unreadMsgs
  if msgCount > 15 then set msgCount to 15
  repeat with i from 1 to msgCount
    set m to item i of unreadMsgs
    set s to sender of m
    set sub to subject of m
    set b to content of m
    set out to out & s & " | " & sub & " | " & (text 1 thru (if length of b > 100 then 100 else length of b) of b) & "\\n"
  end repeat
  return out
end tell`);
    return clip(out.trim()) || "Inbox looks empty (or Mail isn't set up).";
  } catch (e: any) { return `Couldn't read Mail: ${e?.message}`; }
}

async function readAppleNotes(): Promise<string> {
  try {
    const out = await osa(`tell application "Notes"
  set out to ""
  set myNotes to sort notes by modification date descending
  set limit to 8
  set c to 0
  repeat with n in myNotes
    if name of container of n is not "Recently Deleted" then
      set c to c + 1
      if c > limit then exit repeat
      set b to plaintext of n
      set out to out & "== " & (name of n) & " ==\\n" & (text 1 thru (if length of b > 300 then 300 else length of b) of b) & "\\n\\n"
    end if
  end repeat
  return out
end tell`);
    return clip(out.trim()) || "No notes found.";
  } catch (e: any) { return `Couldn't read Notes: ${e?.message}`; }
}



// ── BROWSER AUTOMATION (PLAYWRIGHT) ─────────────────────────
let activeBrowser: any = null;
let activePage: Page | null = null;

async function getPage(): Promise<Page> {
  if (!activePage || activePage.isClosed()) {
    let executablePath = "";
    if (IS_MAC) executablePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    else if (process.platform === "win32") executablePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    else executablePath = "/usr/bin/google-chrome"; 

    try {
      const { chromium } = require("playwright-core");
      await activeBrowser?.close().catch(() => {});   // close the previous browser first — a closed page left the old process orphaned
      activeBrowser = await chromium.launch({ executablePath, headless: false });
      const ctx = await activeBrowser.newContext();
      activePage = await ctx.newPage();
    } catch (e: any) {
      throw new Error(`Could not launch Chrome. Ensure it's installed. Error: ${e.message}`);
    }
  }
  if (!activePage) throw new Error("Browser page unavailable — try the action again.");
  return activePage;
}

async function browserNavigate(url: string) {
  try {
    const p = await getPage();
    await p.goto(url, { waitUntil: "domcontentloaded" });
    return `Navigated to ${url}. Title: ${await p.title()}`;
  } catch (e: any) { return `Failed to navigate: ${e.message}`; }
}

async function browserClick(selector: string) {
  try {
    const p = await getPage();
    await p.click(selector);
    return `Clicked '${selector}'.`;
  } catch (e: any) { return `Failed to click: ${e.message}`; }
}

async function browserType(input: { selector: string; text: string; submit?: boolean }) {
  try {
    const p = await getPage();
    await p.fill(input.selector, input.text);
    if (input.submit) await p.press(input.selector, "Enter");
    return `Typed into '${input.selector}'.`;
  } catch (e: any) { return `Failed to type: ${e.message}`; }
}

async function browserRead() {
  try {
    if (!activePage || activePage.isClosed()) return "No browser tab is currently open. Navigate somewhere first.";
    const p = activePage;
    const text = await p.evaluate(() => document.body.innerText);
    return clip(`[${await p.title()}]\n${text}`, 20000);
  } catch (e: any) { return `Failed to read page: ${e.message}`; }
}


// ── REGISTRY ─────────────────────────────────────────────────
export const TOOLS: Tool[] = [
  // safe · read-only
  { name: "web_search", safe: true, description: "Search the live web. input: a search query string.", params: "query",
    activity: (i) => `Searching the web for “${i.query ?? i}”`, run: (i) => webSearch(i.query ?? i) },
  { name: "web_fetch", safe: true, description: "Open a URL and read its text. input: a url string.", params: "url",
    activity: (i) => `Reading ${i.url ?? i}`, run: (i) => webFetch(i.url ?? i) },
  { name: "retrieve_full", safe: true, description: "Pull back the FULL text of an earlier tool output that was compressed to save tokens (you'll have seen an id like 'web_fetch#3'). input: {id}.", params: "{id}",
    activity: (i) => `Retrieving full output ${i.id ?? i}`, run: async (i) => retrieveFullOutput(String((i.id ?? i) || "")) ?? "That compressed output is no longer cached." },

  // ── 📓 NOTEBOOKS (NotebookLM, but yours & free) + 🔎 deep research + 🛰️ 24/7 agent ──
  { name: "notebook_add", safe: true, description: "Add a source to a notebook (creates it if new) so SAM can answer grounded questions about it. input: {notebook, url? | file? | text?, title?}. Sources: a web page URL, a file path (pdf/docx/txt/md/csv), or pasted text.", params: "{notebook, url?, file?, text?, title?}",
    activity: (i) => `Adding a source to “${i.notebook || "notebook"}”`, run: async (i) => {
      const { id, title } = nb.ensureNotebook(i.notebook || "Research");
      try {
        if (i.url) { const r = await nb.addUrl(id, String(i.url)); return `📓 Added “${r.title}” (${r.chunks} passages) to notebook **${title}**.`; }
        if (i.file) { const n = await nb.addFile(id, String(i.file).replace(/^~/, homedir())); return `📓 Added ${basename(String(i.file))} (${n} passages) to **${title}**.`; }
        if (i.text) { const n = await nb.addText(id, String(i.title || "note"), String(i.text)); return `📓 Added a note (${n} passages) to **${title}**.`; }
        return "Give me a url, file path, or text to add.";
      } catch (e: any) { return `Couldn't add that source: ${e?.message || e}`; }
    } },
  { name: "notebook_ask", safe: true, description: "Ask a question answered ONLY from a notebook's sources, with citations. The world-class 'grounded' mode — no hallucination, every claim traceable. input: {notebook, question}.", params: "{notebook, question}",
    activity: (i) => `Consulting notebook “${i.notebook}”`, run: async (i) => {
      const found = nb.ensureNotebook(i.notebook || "Research");
      const passages = await nb.retrieve(found.id, String(i.question || i), 8);
      if (!passages.length) return `Notebook **${found.title}** has nothing on that yet — add sources with notebook_add.`;
      const srcs = [...new Set(passages.map((p) => p.title))];
      const ctx = passages.map((p, n) => `[${n + 1}] (${p.title})\n${p.text}`).join("\n\n");
      const sys = "You answer STRICTLY from the provided sources — a grounded research assistant. Never use outside knowledge. Cite each claim with its [n] number. If the sources don't cover it, say so plainly. Be clear and well-organised.";
      const r = await runModel("free", sys, `SOURCES:\n${ctx}\n\nQUESTION: ${i.question || i}\n\nAnswer using ONLY the sources above, citing [n]:`);
      return `${r.text}\n\n— grounded in ${srcs.length} source${srcs.length === 1 ? "" : "s"}: ${srcs.slice(0, 6).join(", ")}`;
    } },
  { name: "notebook_audio", safe: true, description: "Generate an 'Audio Overview' — a lively two-host podcast script discussing a notebook's sources (NotebookLM's signature feature). Play it with SAM's voice. input: {notebook}.", params: "{notebook}",
    activity: (i) => `Producing an audio overview of “${i.notebook}”`, run: async (i) => {
      const found = nb.ensureNotebook(i.notebook || "Research");
      const chunks = nb.overviewChunks(found.id, 12);
      if (!chunks.length) return `Notebook **${found.title}** is empty — add sources first.`;
      const material = chunks.map((c) => `• (${c.title}) ${c.text.slice(0, 600)}`).join("\n");
      const sys = "You are a producer writing a short, engaging two-host podcast (hosts: Alex and Sam) that explains the user's material in an accessible, curious way. Natural dialogue, hand-offs, a few 'oh interesting' beats — no fluff, all grounded in the material. 8-14 exchanges. Format each line as 'Alex: …' / 'Sam: …'.";
      const r = await runModel("free", sys, `MATERIAL (from notebook “${found.title}”):\n${material}\n\nWrite the audio-overview script:`);
      return `🎙️ **Audio Overview — ${found.title}**\n\n${r.text}\n\n_(Tap 🔊 or ask “read this aloud” to hear it.)_`;
    } },
  { name: "notebook_list", safe: true, description: "List SAM's notebooks and their sources.", params: "(none)",
    activity: () => `Listing notebooks`, run: async () => {
      const list = nb.listNotebooks();
      if (!list.length) return "No notebooks yet. Create one by adding a source (notebook_add) or running research.";
      return list.map((n) => `📓 **${n.title}** — ${n.sources} source${n.sources === 1 ? "" : "s"}, ${n.chunks} passages`).join("\n");
    } },
  { name: "research", safe: true, description: "Deep web research: searches the live web, reads the top sources, and returns a cited briefing. Optionally files everything into a notebook for follow-up questions. input: {query, notebook?, depth?}.", params: "{query, notebook?, depth?}",
    activity: (i) => `Researching “${i.query ?? i}”`, run: async (i) => {
      const query = String((i.query ?? i) || "").trim();
      if (!query) return "What should I research?";
      const depth = Math.min(6, Math.max(2, Number(i.depth) || 4));
      const results = await webSearch(query).catch(() => "");
      const urls = [...new Set((results.match(/https?:\/\/[^\s)"']+/g) || []))].filter((u) => !/\.(png|jpg|gif|svg|css|js)$/i.test(u)).slice(0, depth);
      if (!urls.length) return `Couldn't find sources for “${query}”.`;
      const nbook = i.notebook ? nb.ensureNotebook(String(i.notebook)) : null;
      const readings: string[] = [];
      for (const u of urls) {
        try {
          const text = await webFetch(u);
          if (text && text.length > 200) { readings.push(`SOURCE (${u}):\n${text.slice(0, 3500)}`); if (nbook) await nb.addUrl(nbook.id, u).catch(() => {}); }
        } catch {}
      }
      if (!readings.length) return `Found links for “${query}” but couldn't read them.`;
      const sys = "You are a sharp research analyst. Synthesise the sources into a clear, well-structured briefing that actually answers the question. Cite sources inline as [1], [2]… matching their order. Flag disagreements and gaps. No filler.";
      const r = await runModel("free", sys, `QUESTION: ${query}\n\n${readings.map((t, n) => t.replace("SOURCE (", `[${n + 1}] SOURCE (`)).join("\n\n")}\n\nWrite the briefing:`);
      const cite = urls.map((u, n) => `[${n + 1}] ${u}`).join("\n");
      return `${r.text}\n\n**Sources**\n${cite}${nbook ? `\n\n_Filed into notebook **${nbook.title}** — ask follow-ups with notebook_ask._` : ""}`;
    } },
  // ── 🟣 OBSIDIAN — SAM reads & writes your second brain (plain markdown on disk) ──
  { name: "obsidian_save", safe: false, description: "Write a note into your Obsidian vault as markdown (SAM adds to your second brain). input: {title, content, folder?}. Uses OBSIDIAN_VAULT, else auto-detects your vault.", params: "{title, content, folder?}",
    activity: (i) => `Saving “${i.title}” to Obsidian`, run: async (i) => {
      const vault = obsidianVault();
      if (!vault) return "I couldn't find your Obsidian vault. Set OBSIDIAN_VAULT in Settings to its folder path.";
      const safeTitle = String(i.title || "SAM note").replace(/[/\\:*?"<>|]/g, "-").slice(0, 80);
      const dir = i.folder ? join(vault, String(i.folder)) : join(vault, "SAM");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${safeTitle}.md`);
      const body = `${i.content || ""}\n\n---\n_Saved by SAM ${new Date().toISOString().slice(0, 16).replace("T", " ")}_\n`;
      await writeFile(file, body, "utf8");
      return `🟣 Saved to Obsidian: **${safeTitle}** (${file.replace(homedir(), "~")})`;
    } },
  { name: "obsidian_index", safe: false, description: "Index your whole Obsidian vault so SAM can answer questions grounded in your notes. input: {} (auto-detects vault) or {path}.", params: "{path?}",
    activity: () => `Indexing your Obsidian vault`, run: async (i) => {
      const vault = i.path ? String(i.path).replace(/^~/, homedir()) : obsidianVault();
      if (!vault || !existsSync(vault)) return "No Obsidian vault found — set OBSIDIAN_VAULT in Settings, or pass its path.";
      const r = await ingestFolder(vault, 2000);
      return `🟣 Indexed your Obsidian vault — ${r.ingested} notes, ${r.chunks} passages. Ask me anything about your notes now (search_docs / notebook_ask).`;
    } },

  // ── 📢 POST EVERYWHERE — one command, all your connected channels ──
  { name: "post_everywhere", safe: false, description: "Post the same message to ALL connected channels at once (Discord, Slack directly; X/Instagram/Facebook/LinkedIn via the Metricool integration if connected). input: {text}.", params: "{text}",
    activity: () => `Posting to all channels`, run: async (i) => {
      const text = String((i.text ?? i) || "").trim();
      if (!text) return "What should I post?";
      const results: string[] = [];
      // Discord — incoming webhook (simplest, no OAuth)
      const dh = process.env.DISCORD_WEBHOOK_URL;
      if (dh) {
        try { const r = await fetch(dh, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text.slice(0, 2000) }), signal: AbortSignal.timeout(15000) }); results.push(r.ok ? "✅ Discord" : `⚠️ Discord (${r.status})`); }
        catch { results.push("⚠️ Discord (failed)"); }
      }
      // Slack — chat.postMessage with a bot token (needs SLACK_CHANNEL)
      const st = process.env.SLACK_BOT_TOKEN, sc = process.env.SLACK_CHANNEL;
      if (st && sc) {
        try { const r = await fetch("https://slack.com/api/chat.postMessage", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${st}` }, body: JSON.stringify({ channel: sc, text }), signal: AbortSignal.timeout(15000) }); const d: any = await r.json(); results.push(d?.ok ? "✅ Slack" : `⚠️ Slack (${d?.error || "failed"})`); }
        catch { results.push("⚠️ Slack (failed)"); }
      }
      const socialHint = "For X · Instagram · Facebook · LinkedIn in one shot, connect **Metricool** in Settings → Integrations, then I'll schedule/post there too.";
      if (!results.length) return `No direct channels connected yet. Set DISCORD_WEBHOOK_URL and/or SLACK_BOT_TOKEN + SLACK_CHANNEL in Settings.\n\n${socialHint}`;
      return `📢 Posted:\n${results.map((r) => "  " + r).join("\n")}\n\n${socialHint}`;
    } },

  { name: "research_watch", safe: false, description: "Set up a 24/7 research agent: SAM keeps researching a topic on a schedule, files new findings into a notebook, and pings you what's new. input: {topic, notebook?, every_hours?}.", params: "{topic, notebook?, every_hours?}",
    activity: (i) => `Setting up a 24/7 watch on “${i.topic}”`, run: async (i) => {
      const topic = String(i.topic || "").trim();
      if (!topic) return "What topic should I watch?";
      const notebook = String(i.notebook || topic).slice(0, 48);
      const hrs = Math.min(24, Math.max(1, Number(i.every_hours) || 6));
      nb.ensureNotebook(notebook);
      const cron = `0 */${hrs} * * *`;   // every N hours
      const command = `Research the very latest on "${topic}", add anything new to notebook "${notebook}", and give me a 2-line update on what changed. If nothing is new, say so briefly.`;
      const s = addSchedule(command, cron);
      return `🛰️ 24/7 research agent is live — I'll sweep the web on **${topic}** every ${hrs}h, file it into notebook **${notebook}**, and ping you what's new. (schedule ${s.id})`;
    } },
  { name: "read_file", safe: true, description: "Read a file's contents. input: a file path (supports ~).", params: "path",
    activity: (i) => `Reading file ${i.path ?? i}`, run: (i) => readFileTool(i.path ?? i) },
  { name: "list_dir", safe: true, description: "List a folder's contents. input: a folder path (supports ~).", params: "path",
    activity: (i) => `Looking in ${i.path ?? i ?? "~"}`, run: (i) => listDir(i.path ?? i ?? "~") },
  { name: "folder_digest", safe: true, description: "Summarise a folder: file count, total size, top file types, and the largest files. input: a folder path (supports ~).", params: "path",
    activity: (i) => `Sizing up ${i.path ?? i ?? "~"}`, run: (i) => folderDigest(i.path ?? i ?? "~") },
  { name: "find_duplicates", safe: true, description: "Find duplicate files (identical contents) in a folder, grouped, with total reclaimable space. input: a folder path (supports ~).", params: "path",
    activity: (i) => `Hunting duplicates in ${i.path ?? i ?? "~"}`, run: (i) => findDuplicates(i.path ?? i ?? "~") },
  { name: "recent_files", safe: true, description: "List the most recently modified files in a folder (name, when, size), newest first — great for 'what did I work on lately'. input: { path, limit? } (path supports ~; limit defaults to 15).", params: "path, limit?",
    activity: (i) => `Finding recent files in ${i.path ?? i ?? "~"}`, run: (i) => recentFiles(i.path ?? i ?? "~", i.limit) },
  { name: "screenshot", safe: true, description: "Take a screenshot of the screen, saved to the Desktop.", params: "(none)",
    activity: () => `Taking a screenshot`, run: screenshot },
  { name: "clipboard_get", safe: true, description: "Read the current clipboard text.", params: "(none)",
    activity: () => `Reading the clipboard`, run: clipboardGet },
  { name: "get_datetime", safe: true, description: "Get the current date and time.", params: "(none)",
    activity: () => `Checking the time`, run: async () => nowText() },
  { name: "set_timer", safe: true, description: "Set a short local timer (minutes). SAM will notify the OS when time is up. input: {minutes, reason?}.", params: "{minutes, reason?}",
    activity: (i) => `Setting a timer for ${i.minutes}m`, 
    run: async (i) => {
      const min = Number(i.minutes);
      if (Number.isNaN(min) || min <= 0) return "Invalid minutes.";
      setTimeout(() => {
        notify({ title: "Timer Done", message: i.reason || "Time is up!" });
      }, min * 60000);
      return `Timer set for ${min} minute(s). I will notify you when it's done.`;
    } },
  { name: "world_clock", safe: true, description: "Get the current time in a specific timezone (e.g. 'America/New_York', 'Asia/Tokyo'). input: {timezone}.", params: "{timezone}",
    activity: (i) => `Checking time in ${i.timezone}`,
    run: async (i) => {
      try {
        return new Intl.DateTimeFormat("en-US", { timeZone: i.timezone, dateStyle: "full", timeStyle: "long" }).format(new Date());
      } catch (e: any) { return `Invalid timezone or error: ${e.message}`; }
    } },
  { name: "password_generate", safe: true, description: "Generate a cryptographically secure random password. input: {length?}.", params: "{length?}",
    activity: () => `Generating a secure password`,
    run: async (i) => {
      const len = Number(i?.length) || 16;
      const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+~`|}{[]:;?><,./-=";
      const bytes = randomBytes(len);
      let pass = "";
      for (let j = 0; j < len; j++) pass += chars[bytes[j] % chars.length];
      return `Generated password (length ${len}): ${pass}`;
    } },
  { name: "wifi_info", safe: true, description: "Get current Wi-Fi network name and details.", params: "(none)",
    activity: () => `Checking Wi-Fi`,
    run: async () => {
      if (!IS_MAC) return "Wi-Fi info only works on macOS.";
      try {
        const { stdout } = await sh("networksetup -getairportnetwork en0");
        return stdout.trim();
      } catch (e: any) { return `Failed to get Wi-Fi: ${e.message}`; }
    } },
  { name: "lock_screen", safe: false, description: "Lock the Mac immediately.", params: "(none)",
    activity: () => `Locking the screen`, preview: () => `Lock the screen`,
    run: async () => {
      if (!IS_MAC) return "Lock screen only works on macOS.";
      try { await sh("pmset displaysleepnow"); return "Screen locked."; } catch (e: any) { return `Failed to lock: ${e.message}`; }
    } },
  { name: "empty_trash", safe: false, description: "Permanently empty the macOS Trash.", params: "(none)",
    activity: () => `Emptying the Trash`, preview: () => `Permanently delete all files in ~/.Trash`,
    run: async () => {
      if (!IS_MAC) return "Trash only works on macOS.";
      try { await sh("rm -rf ~/.Trash/*"); return "Trash emptied."; } catch (e: any) { return `Failed to empty trash: ${e.message}`; }
    } },
  { name: "eject_disk", safe: false, description: "Eject a mounted disk/volume. input: {volume_name}.", params: "{volume_name}",
    activity: (i) => `Ejecting ${i.volume_name}`, preview: (i) => `Eject volume: ${i.volume_name}`,
    run: async (i) => {
      if (!IS_MAC) return "Eject only works on macOS.";
      try { await sh(`diskutil eject ${shq("/Volumes/" + String(i.volume_name).replace(/\//g, ""))}`); return `Ejected ${i.volume_name}.`; } catch (e: any) { return `Failed to eject: ${e.message}`; }
    } },
  { name: "caffeinate", safe: true, description: "Prevent the Mac from sleeping for a duration. input: {minutes}.", params: "{minutes}",
    activity: (i) => `Keeping Mac awake for ${i.minutes}m`,
    run: async (i) => {
      if (!IS_MAC) return "Caffeinate only works on macOS.";
      const min = Number(i.minutes);
      if (Number.isNaN(min) || min <= 0) return "Invalid minutes.";
      try {
        // Run in background detached
        sh(`caffeinate -d -t ${min * 60} &`);
        return `Mac will stay awake for ${min} minute(s).`;
      } catch (e: any) { return `Failed to caffeinate: ${e.message}`; }
    } },
  { name: "disk_usage", safe: true, description: "Check exactly how much free space is left on the main drive.", params: "(none)",
    activity: () => `Checking disk usage`,
    run: async () => {
      try {
        const { stdout } = await sh("df -h /");
        return stdout.trim();
      } catch (e: any) { return `Failed to read disk usage: ${e.message}`; }
    } },
  { name: "app_switcher", safe: false, description: "Bring an installed macOS application to the foreground. input: {app_name}.", params: "{app_name}",
    activity: (i) => `Switching to ${i.app_name}`, preview: (i) => `Bring app to front: ${i.app_name}`,
    run: async (i) => {
      if (!IS_MAC) return "App switching only works on macOS.";
      try {
        await osa(`tell application "${esc(i.app_name)}" to activate`);
        return `Activated ${i.app_name}.`;
      } catch (e: any) { return `Failed to activate app: ${e.message}`; }
    } },
  { name: "set_wallpaper", safe: false, description: "Set the macOS desktop wallpaper. input: {image_path}. Note: Path must be absolute.", params: "{image_path}",
    activity: () => `Changing wallpaper`, preview: (i) => `Set wallpaper to:\n${i.image_path}`,
    run: async (i) => {
      if (!IS_MAC) return "Wallpaper control only works on macOS.";
      try {
        await osa(`tell application "System Events" to set picture of every desktop to "${i.image_path.replace(/"/g, "")}"`);
        return "Wallpaper updated successfully.";
      } catch (e: any) { return `Failed to set wallpaper: ${e.message}`; }
    } },
  { name: "shorten_url", safe: true, description: "Shorten a long URL using the free is.gd service. input: {url}.", params: "{url}",
    activity: () => `Shortening URL`,
    run: async (i) => {
      try {
        const res = await tfetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(i.url)}`);
        if (!res.ok) throw new Error("API returned " + res.status);
        return await res.text();
      } catch (e: any) { return `Failed to shorten URL: ${e.message}`; }
    } },
  { name: "currency_convert", safe: true, description: "Convert an amount between standard global currencies (e.g., USD to EUR). input: {amount, from_currency, to_currency}.", params: "{amount, from, to}",
    activity: (i) => `Converting ${i.amount} ${i.from} to ${i.to}`,
    run: async (i) => {
      try {
        const base = (i.from || "USD").toUpperCase();
        const target = (i.to || "EUR").toUpperCase();
        const res = await tfetch(`https://open.er-api.com/v6/latest/${base}`);
        if (!res.ok) throw new Error("Currency API returned " + res.status);
        const data = await res.json();
        const rate = data.rates[target];
        if (!rate) return `Unknown currency code: ${target}`;
        const final = (Number(i.amount) * rate).toFixed(2);
        return `${i.amount} ${base} = ${final} ${target} (Rate: ${rate})`;
      } catch (e: any) { return `Failed to convert: ${e.message}`; }
    } },
  { name: "qr_generate", safe: true, description: "Generate a QR code PNG and save it to the Desktop. input: {text_or_url}.", params: "{text_or_url}",
    activity: () => `Generating a QR code`,
    run: async (i) => {
      try {
        const text = i.text_or_url || i.text || i.url;
        const res = await tfetch(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`);
        if (!res.ok) throw new Error("QR API returned " + res.status);
        const arrayBuffer = await res.arrayBuffer();
        const path = resolve(homedir(), "Desktop", `QR_${Date.now()}.png`);
        await writeFile(path, Buffer.from(arrayBuffer));
        return `QR code generated and saved to: ${path}`;
      } catch (e: any) { return `Failed to generate QR code: ${e.message}`; }
    } },
  { name: "volume_brightness_control", safe: false, description: "Set the Mac's hardware output volume, 0-100. input: {type: 'volume', level}. (Brightness is NOT supported — it needs an external CLI tool and we keep deps at zero.)", params: "{type, level}",
    activity: (i) => `Setting ${i.type} to ${i.level}%`,
    preview: (i) => `Set ${i.type} hardware to ${i.level}%`,
    run: async (i) => {
      if (!IS_MAC) return "Hardware control only works on macOS.";
      const lvl = Math.min(100, Math.max(0, Number(i.level) || 0));
      if (i.type === "brightness") {
        // Brightness via AppleScript uses displays slider (1-10 scale usually, tricky without 3rd party tools, but we can try System Events)
        // Safer universal way without external tools:
        return "Brightness control requires external CLI tools (like 'brightness') on macOS. Skipping to keep dependencies zero.";
      } else {
        try {
          await osa(`set volume output volume ${lvl}`);
          return `Hardware volume set to ${lvl}%.`;
        } catch (e: any) { return `Failed to set volume: ${e.message}`; }
      }
    } },
  { name: "ip_geolocate", safe: true, description: "Get the physical location, ISP, and timezone of an IP address. input: {ip}.", params: "{ip}",
    activity: (i) => `Geolocating IP ${i.ip}`,
    run: async (i) => {
      try {
        const res = await tfetch(`http://ip-api.com/json/${i.ip}`);
        if (!res.ok) throw new Error("API returned " + res.status);
        const data = await res.json();
        if (data.status === "fail") return `Geolocation failed: ${data.message}`;
        return `IP: ${data.query}\nLocation: ${data.city}, ${data.regionName}, ${data.country}\nISP: ${data.isp}\nTimezone: ${data.timezone}`;
      } catch (e: any) { return `Failed to geolocate: ${e.message}`; }
    } },
  { name: "whois", safe: true, description: "Fetch domain registration info natively. input: {domain}.", params: "{domain}",
    activity: (i) => `Running whois on ${i.domain}`,
    run: async (i) => {
      try {
        const { stdout } = await sh(`whois ${shq(i.domain)}`);
        // WHOIS outputs can be massive, slice to top 2000 chars to save token context
        return stdout.trim().slice(0, 2000) + (stdout.length > 2000 ? "\n...(truncated)" : "");
      } catch (e: any) { return `WHOIS failed: ${e.message}`; }
    } },
  { name: "unit_convert", safe: true, description: "Convert standard measurement units (C/F, kg/lb, mi/km, m/ft). input: {amount, from, to}.", params: "{amount, from, to}",
    activity: (i) => `Converting ${i.amount} ${i.from} to ${i.to}`,
    run: async (i) => {
      const v = Number(i.amount);
      if (Number.isNaN(v)) return "Invalid amount.";
      const f = String(i.from).toLowerCase();
      const t = String(i.to).toLowerCase();
      let res = 0;
      if ((f === "c" || f === "celsius") && (t === "f" || t === "fahrenheit")) res = (v * 9/5) + 32;
      else if ((f === "f" || f === "fahrenheit") && (t === "c" || t === "celsius")) res = (v - 32) * 5/9;
      else if ((f === "kg" || f === "kilograms") && (t === "lb" || t === "pounds")) res = v * 2.20462;
      else if ((f === "lb" || f === "pounds") && (t === "kg" || t === "kilograms")) res = v / 2.20462;
      else if ((f === "mi" || f === "miles") && (t === "km" || t === "kilometers")) res = v * 1.60934;
      else if ((f === "km" || f === "kilometers") && (t === "mi" || t === "miles")) res = v / 1.60934;
      else if ((f === "m" || f === "meters") && (t === "ft" || t === "feet")) res = v * 3.28084;
      else if ((f === "ft" || f === "feet") && (t === "m" || t === "meters")) res = v / 3.28084;
      else return `Unsupported conversion: ${f} to ${t}. Use standard C/F, kg/lb, mi/km, m/ft.`;
      return `${v} ${f} = ${res.toFixed(2)} ${t}`;
    } },
  { name: "color_tools", safe: true, description: "Convert a color between HEX and RGB format. input: {color} e.g. '#FF0000' or '255,0,0'.", params: "{color}",
    activity: () => `Converting color`,
    run: async (i) => {
      const c = String(i.color).trim();
      if (c.startsWith("#")) {
        const hex = c.replace("#", "");
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `HEX ${c} = RGB(${r}, ${g}, ${b})`;
      } else {
        const parts = c.split(/[ ,]+/).map(Number);
        if (parts.length >= 3) {
          const hex = "#" + parts.slice(0, 3).map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
          return `RGB(${parts.slice(0,3).join(", ")}) = HEX ${hex}`;
        }
        return "Invalid format. Provide HEX (#RRGGBB) or RGB (R,G,B).";
      }
    } },
  { name: "translate", safe: true, description: "Translate text using the free Google Translate API. input: {text, target_lang_code} (e.g. 'es', 'fr', 'ja').", params: "{text, target_lang_code}",
    activity: (i) => `Translating to ${i.target_lang_code}`,
    run: async (i) => {
      try {
        const target = encodeURIComponent(i.target_lang_code || "en");
        const text = encodeURIComponent(i.text);
        const res = await tfetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${text}`);
        if (!res.ok) throw new Error("Translate API failed");
        const data = await res.json();
        const translated = data[0].map((chunk: any) => chunk[0]).join("");
        return translated;
      } catch (e: any) { return `Failed to translate: ${e.message}`; }
    } },
  { name: "weather_forecast_7day", safe: true, description: "Get a rich 7-day weather forecast (JSON). input: {location}.", params: "{location}",
    activity: (i) => `Pulling 7-day forecast for ${i.location}`,
    run: async (i) => {
      try {
        const res = await tfetch(`https://wttr.in/${encodeURIComponent(i.location || "")}?format=j1`);
        if (!res.ok) throw new Error("Weather API failed");
        const data = await res.json();
        const current = data.current_condition[0];
        const future = data.weather.slice(0, 7).map((w: any) => `${w.date}: ${w.maxtempC}C/${w.mintempC}C (Rain: ${w.hourly[0]?.chanceofrain || 0}%)`).join("\\n");
        return `Current: ${current.temp_C}C, ${current.weatherDesc[0].value}\\nForecast:\\n${future}`;
      } catch (e: any) { return `Failed to get forecast: ${e.message}`; }
    } },
  { name: "stock_price", safe: true, description: "Get live market data for a stock ticker symbol (e.g. AAPL, TSLA). input: {ticker}.", params: "{ticker}",
    activity: (i) => `Checking stock price for ${i.ticker}`,
    run: async (i) => {
      try {
        const res = await tfetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(i.ticker)}`);
        if (!res.ok) throw new Error("Finance API returned " + res.status);
        const data = await res.json();
        const meta = data.chart.result[0].meta;
        return `${meta.symbol}: $${meta.regularMarketPrice} (Prev Close: $${meta.previousClose})`;
      } catch (e: any) { return `Failed to fetch stock: ${e.message}`; }
    } },
  { name: "news_rss", safe: true, description: "Fetch the top 5 global news headlines from Google News RSS.", params: "(none)",
    activity: () => `Fetching top news`,
    run: async () => {
      try {
        const res = await tfetch("https://news.google.com/rss");
        if (!res.ok) throw new Error("News API failed");
        const xml = await res.text();
        const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
        const top = items.slice(0, 5).map(item => {
          const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
          const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
          return `- ${titleMatch ? titleMatch[1] : "No Title"}\\n  ${linkMatch ? linkMatch[1] : "No Link"}`;
        });
        return top.length ? top.join("\\n\\n") : "No news found.";
      } catch (e: any) { return `Failed to fetch news: ${e.message}`; }
    } },
  { name: "dedupe_files", safe: true, description: "Recursively scan a directory, hash all files, and list exact duplicates (read-only, does not delete). input: {dir}.", params: "{dir}",
    activity: (i) => `Scanning ${i.dir} for duplicates`,
    run: async (i) => {
      try {
        const dir = resolve(i.dir);
        const map = new Map<string, string[]>();
        async function walk(currentDir: string) {
          const files = await readdir(currentDir);
          for (const file of files) {
            const filepath = join(currentDir, file);
            const stats = await stat(filepath);
            if (stats.isDirectory()) await walk(filepath);
            else if (stats.isFile()) {
              const buffer = await readFile(filepath);
              const hash = createHash("sha256").update(buffer).digest("hex");
              if (!map.has(hash)) map.set(hash, []);
              map.get(hash)!.push(filepath);
            }
          }
        }
        await walk(dir);
        let out = "";
        for (const [_hash, paths] of map.entries()) {
          if (paths.length > 1) {
            out += `Duplicate Group:\\n` + paths.map(p => `  - ${p}`).join("\\n") + "\\n\\n";
          }
        }
        return out.trim() || "No duplicates found.";
      } catch (e: any) { return `Failed to dedupe files: ${e.message}`; }
    } },
  { name: "add_calendar_event", safe: false, description: "Create a scheduled event in Calendar. input: {title, start_date, end_date} (Dates parseable like '12/25/2026 14:00').", params: "{title, start_date, end_date}",
    activity: (i) => `Scheduling ${i.title} on Calendar`, preview: (i) => `Add to Calendar:\n${i.title}\nFrom: ${i.start_date}\nTo: ${i.end_date}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          await osa(`tell application "Calendar" to tell calendar 1 to make new event at end of events with properties {summary:"${esc(i.title)}", start date:date "${esc(i.start_date)}", end date:date "${esc(i.end_date)}"}`);
          return "Event created successfully in default Calendar.";
        } else {
          return notSupported("Calendar");
        }
      } catch (err: any) { return `Failed to create event: ${err.message}`; }
    } },

  { name: "create_note", safe: true, description: "Create a new note. input: {title, body}.", params: "{title, body}",
    activity: (i) => `Creating Note: ${i.title}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const content = `<h1>${i.title}</h1><p>${i.body.replace(/\n/g, "<br>")}</p>`;
          await osa(`tell application "Notes" to make new note with properties {body:"${content.replace(/"/g, "\\\"")}"}`);
          return "Note created successfully.";
        } else {
          const notesDir = resolve(homedir(), "SAM_Notes");
          mkdirSync(notesDir, { recursive: true });
          const file = resolve(notesDir, `${i.title.replace(/[^a-z0-9]/gi, '_')}.txt`);
          await writeFile(file, i.body);
          return `Note saved to ${file}.`;
        }
      } catch (e: any) { return `Failed to create note: ${e.message}`; }
    } },
  { name: "search_notes", safe: true, description: "Search Notes and return content of matches. input: {query}.", params: "{query}",
    activity: (i) => `Searching Notes for "${i.query}"`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const script = `tell application "Notes"\nset matchNotes to notes whose name contains "${i.query.replace(/"/g, "")}" or body contains "${i.query.replace(/"/g, "")}"\nset out to ""\nrepeat with n in matchNotes\nset out to out & "Title: " & name of n & "\\n" & body of n & "\\n\\n"\nend repeat\nreturn out\nend tell`;
          const result = await osa(script);
          return result.trim() || "No matching notes found.";
        } else {
          const notesDir = resolve(homedir(), "SAM_Notes");
          const hitFiles = await findByContent(notesDir, String(i.query), 20); const stdout = hitFiles.join("\n");
          return stdout.trim() || "No matching notes found.";
        }
      } catch (e: any) { return `Failed to search notes: ${e.message}`; }
    } },
  { name: "send_mail", safe: false, description: "Send an email from SAM's OWN address via SMTP (works cross-platform, no Mail app needed). Defaults to the owner's inbox if 'to' is omitted. Needs SMTP set up in .env. input: {to?, subject, body}.", params: "{to?, subject, body}",
    activity: (i) => `Emailing ${i.to || ownerEmail() || "you"}`,
    preview: (i) => `Send email (from SAM) to ${i.to || ownerEmail() || "you"}:\nSubject: ${i.subject}\n\n${i.body}`,
    run: async (i) => {
      if (!mailerConfigured()) return "SAM's email isn't set up yet. Add SMTP_HOST / SMTP_USER / SMTP_PASS (and optionally SMTP_FROM, SAM_OWNER_EMAIL) to .env — see .env.example.";
      const r = await sendMail(i.to || "", i.subject || "", i.body || "");
      return r.ok ? `Sent ✓ to ${i.to || ownerEmail()}.` : `Couldn't send: ${r.error}`;
    } },
  { name: "send_email", safe: false, description: "Draft an email in the default mail client. input: {to_email, subject, body}.", params: "{to_email, subject, body}",
    activity: (i) => `Drafting email to ${i.to_email}`, preview: (i) => `Draft email to ${i.to_email}:\nSubject: ${i.subject}\n${i.body}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const script = `tell application "Mail"\nset theMessage to make new outgoing message with properties {subject:"${i.subject.replace(/"/g, "\\\"")}", content:"${i.body.replace(/"/g, "\\\"")}", visible:false}\ntell theMessage\nmake new to recipient at end of to recipients with properties {address:"${i.to_email.replace(/"/g, "\\\"")}"}\nsend\nend tell\nend tell`;
          await osa(script);
          return `Email sent successfully to ${i.to_email}.`;
        } else {
          await openUrl(`mailto:${i.to_email}?subject=${encodeURIComponent(i.subject)}&body=${encodeURIComponent(i.body)}`);
          return `Opened email draft to ${i.to_email} in the default mail client.`;
        }
      } catch (e: any) { return `Failed to send email: ${e.message}`; }
    } },
  { name: "open_maps", safe: true, description: "Instantly launch Maps with a specific address or search query. input: {address_or_query}.", params: "{address_or_query}",
    activity: (i) => `Opening Maps for ${i.address_or_query}`,
    run: async (i) => {
      const q = encodeURIComponent(i.address_or_query);
      // openUrl prepends https:// to anything non-http, which would mangle maps://
      // into https://maps://… — open the maps: scheme directly instead.
      if (IS_MAC) return sh(openCmd(`maps://?q=${q}`)).then(() => `Apple Maps opened for: ${i.address_or_query}`);
      else return openUrl(`https://www.google.com/maps/search/?api=1&query=${q}`).then(() => `Google Maps opened for: ${i.address_or_query}`);
    } },
  { name: "add_contact", safe: false, description: "Programmatically add a new person to your native Contacts. input: {first_name, last_name?, phone?, email?}.", params: "{first_name, last_name?, phone?, email?}",
    activity: (i) => `Adding contact: ${i.first_name}`, preview: (i) => `Add to Contacts:\nName: ${i.first_name} ${i.last_name || ""}\nPhone: ${i.phone || ""}\nEmail: ${i.email || ""}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const lastStr = i.last_name ? `last name:"${i.last_name.replace(/"/g, "\\\"")}", ` : "";
          let script = `tell application "Contacts"\nset newPerson to make new person with properties {first name:"${i.first_name.replace(/"/g, "\\\"")}", ${lastStr}}\n`;
          if (i.phone) script += `make new phone at end of phones of newPerson with properties {label:"Mobile", value:"${i.phone.replace(/"/g, "\\\"")}"}\n`;
          if (i.email) script += `make new email at end of emails of newPerson with properties {label:"Work", value:"${i.email.replace(/"/g, "\\\"")}"}\n`;
          script += `save\nend tell`;
          await osa(script);
          return "Contact added successfully.";
        } else {
          const vcf = `BEGIN:VCARD\nVERSION:3.0\nN:${i.last_name || ""};${i.first_name};;;\nFN:${i.first_name} ${i.last_name || ""}\nTEL;TYPE=CELL:${i.phone || ""}\nEMAIL;TYPE=WORK:${i.email || ""}\nEND:VCARD`;
          const contactsDir = resolve(homedir(), "SAM_Contacts");
          mkdirSync(contactsDir, { recursive: true });
          const file = resolve(contactsDir, `${i.first_name}_${i.last_name || ""}.vcf`.trim());
          await writeFile(file, vcf);
          return `Contact saved as VCF in ${file}.`;
        }
      } catch (e: any) { return `Failed to add contact: ${e.message}`; }
    } },
  { name: "toggle_dark_mode", safe: true, description: "Flip the macOS system appearance between Dark Mode and Light Mode natively.", params: "(none)",
    activity: () => `Toggling Dark Mode`,
    run: async () => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        await osa(`tell application "System Events" to tell appearance preferences to set dark mode to not dark mode`);
        return "Toggled macOS Dark Mode successfully.";
      } catch (e: any) { return `Failed to toggle Dark Mode: ${e.message}`; }
    } },
  { name: "get_frontmost_app", safe: true, description: "Get the name of the macOS application you are currently looking at on screen.", params: "(none)",
    activity: () => `Checking frontmost app`,
    run: async () => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        const result = await osa(`tell application "System Events" to get name of first application process whose frontmost is true`);
        return `Frontmost app: ${result.trim()}`;
      } catch (e: any) { return `Failed to get frontmost app: ${e.message}`; }
    } },
  { name: "get_location", safe: true, description: "Get the user's current approximate location (city/region).", params: "(none)",
    activity: () => `Checking your location`, run: async () => (await fetchLocation(true)) || "Couldn't determine location (offline?)." },
  { name: "notify", safe: true, description: "Show a macOS notification. input: {title?, message}.", params: "{title?, message}",
    activity: (_i) => `Sending a notification`, run: (i) => notify(i) },
  { name: "get_weather", safe: true, description: "Get current weather. input: a place name (city).", params: "place",
    activity: (i) => `Checking the weather in ${i.place ?? i ?? "your area"}`, run: (i) => getWeather(i.place ?? i ?? "") },

  // ── FREE UTILITY BATCH — no API keys, local OS or free web ──
  { name: "battery_status", safe: true, description: "Check the battery level and charging state.", params: "(none)",
    activity: () => `Checking battery`, run: getBattery },   // cross-platform (Mac/Win/Linux)
  { name: "toggle_dnd", safe: false, description: "Toggle Mac Do Not Disturb / Focus on or off. input: {on: boolean}.", params: "{on: boolean}",
    activity: (i) => `Turning Do Not Disturb ${i.on ? "on" : "off"}`,
    run: async (i) => {
      if (!IS_MAC) return "Do Not Disturb toggle only supported on macOS.";
      try {
        const s = await sh(`shortcuts run "Turn Do Not Disturb ${i.on ? "On" : "Off"}" 2>/dev/null || echo "failed"`).catch(() => ({stdout: "failed"}));
        if (!s.stdout.includes("failed")) return `DND is now ${i.on ? "on" : "off"}.`;
        const script = `tell application "System Events" to tell application process "Control Center"\n  try\n    click menu bar item "Focus" of menu bar 1\n    delay 0.3\n    click checkbox 1 of scroll area 1 of window "Control Center"\n    delay 0.3\n    click menu bar item "Focus" of menu bar 1\n    return "Toggled Do Not Disturb via GUI."\n  on error\n    return "Failed to toggle DND. You may need to grant Accessibility permissions or create a 'Turn Do Not Disturb On/Off' Apple Shortcut."\n  end try\nend tell`;
        const res = await osa(script);
        return res.trim();
      } catch (e: any) { return `Failed: ${e.message}`; }
    }
  },
  { name: "quick_note", safe: true, description: "Jot a quick note into SAM's vault. input: text.", params: "text",
    activity: () => `Saving a note`,
    run: async (i) => { const p = safePath("./vault/notes/quick.md"); mkdirSync(dirname(p), { recursive: true }); await writeFile(p, `[${nowText()}] ${String(i.text ?? i)}\n`, { flag: "a" }); return `📝 Noted to your vault.`; } },
  { name: "crypto_price", safe: true, description: "Get a crypto price. input: coin (bitcoin, ethereum…).", params: "coin",
    activity: (i) => `Checking ${i.coin ?? i} price`,
    run: async (i) => { try { const coin = String(i.coin ?? i).toLowerCase(); const d: any = await (await tfetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd,gbp`)).json(); const p = d?.[coin]; return p ? `🪙 ${coin}: $${p.usd} · £${p.gbp}` : `Couldn't find "${coin}".`; } catch (e: any) { return `Crypto lookup failed: ${e?.message}`; } } },
  { name: "define_word", safe: true, description: "Define a word. input: word.", params: "word",
    activity: (i) => `Defining "${i.word ?? i}"`,
    run: async (i) => { try { const w = String(i.word ?? i); const d: any = await (await tfetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`)).json(); const defs = d?.[0]?.meanings?.slice(0, 2).map((m: any) => `(${m.partOfSpeech}) ${m.definitions?.[0]?.definition}`).join("\n"); return defs ? `📖 ${w}\n${defs}` : `No definition for "${w}".`; } catch (e: any) { return `Lookup failed: ${e?.message}`; } } },
  { name: "wikipedia", safe: true, description: "Get a Wikipedia summary. input: topic.", params: "topic",
    activity: (i) => `Reading Wikipedia: ${i.topic ?? i}`,
    run: async (i) => { try { const t = String(i.topic ?? i); const d: any = await (await tfetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`)).json(); return d?.extract ? `📚 ${d.title}\n${d.extract}` : `No Wikipedia page for "${t}".`; } catch (e: any) { return `Lookup failed: ${e?.message}`; } } },
  { name: "hacker_news", safe: true, description: "Top Hacker News stories right now.", params: "(none)",
    activity: () => `Fetching Hacker News`,
    run: async () => { try { const ids: any = await (await tfetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json(); const top = await Promise.all(ids.slice(0, 8).map(async (id: number) => { const s: any = await (await tfetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json(); return `• ${s.title} (${s.score}▲) ${s.url || ""}`; })); return `📰 Top HN:\n${top.join("\n")}`; } catch (e: any) { return `HN fetch failed: ${e?.message}`; } } },
  { name: "dns_lookup", safe: true, description: "DNS lookup for a domain. input: domain.", params: "domain",
    activity: (i) => `DNS lookup: ${i.domain ?? i}`,
    run: async (i) => {
      const domain = String(i.domain ?? i).trim().replace(/^https?:\/\//, "").split("/")[0];
      try {
        const dns = await import("node:dns/promises");
        const [a, aaaa] = await Promise.all([dns.resolve4(domain).catch(() => [] as string[]), dns.resolve6(domain).catch(() => [] as string[])]);
        const recs = [...a.map((x) => `A     ${x}`), ...aaaa.map((x) => `AAAA  ${x}`)];
        return recs.length ? recs.join("\n") : "No records found.";
      } catch (e: any) { return `Lookup failed: ${e?.message}`; }
    } },
  { name: "open_url", safe: true, description: "Open a URL in the default browser. input: url.", params: "url",
    activity: (i) => `Opening ${i.url ?? i}`, run: (i) => openUrl(i.url ?? i) },
  { name: "search_files", safe: true, description: "Search the Mac for files by name/content (Spotlight). input: query.", params: "query",
    activity: (i) => `Searching your files for “${i.query ?? i}”`, run: (i) => searchFiles(i.query ?? i) },

  // ── GitHub (via the gh CLI the user's already logged into) ──
  { name: "github_repos", safe: true, description: "List the user's GitHub repositories (name, visibility, description). input: {limit?}.", params: "{limit?}",
    activity: () => `Listing your GitHub repos`,
    run: (i) => gh(`repo list --limit ${Math.min(Number(i?.limit) || 30, 100)}`) },
  { name: "github_repo", safe: true, description: "View a repo's overview + README. input: {repo} e.g. 'owner/repo'.", params: "{repo}",
    activity: (i) => `Looking at ${i.repo ?? i} on GitHub`,
    run: (i) => gh(`repo view ${shq(i.repo ?? i)}`) },
  { name: "github_issues", safe: true, description: "List open issues on a repo. input: {repo, limit?}.", params: "{repo, limit?}",
    activity: (i) => `Checking issues on ${i.repo ?? i}`,
    run: (i) => gh(`issue list -R ${shq(i.repo ?? i)} --limit ${Math.min(Number(i?.limit) || 20, 50)}`) },
  { name: "github_read_file", safe: true, description: "Read a file from a repo. input: {repo, path}.", params: "{repo, path}",
    activity: (i) => `Reading ${i.path} from ${i.repo}`,
    run: (i) => gh(`api ${shq(`repos/${i.repo}/contents/${i.path}`)} -H ${shq("Accept: application/vnd.github.raw")}`) },
  { name: "github_create_issue", safe: false, description: "Open a new issue on a repo. input: {repo, title, body?}.", params: "{repo, title, body?}",
    activity: (i) => `Opening a GitHub issue on ${i.repo}: “${i.title}”`,
    preview: (i) => `Create a GitHub issue on ${i.repo}\nTitle: ${i.title}\n${i.body || ""}`.slice(0, 300),
    run: (i) => gh(`issue create -R ${shq(i.repo)} --title ${shq(i.title)} --body ${shq(i.body || "")}`) },
  { name: "my_apps", safe: true, description: "List the user's own in-house apps (their GitHub repos), grabbed at startup, with descriptions.", params: "(none)",
    activity: () => `Pulling up your apps`,
    run: async () => { const a = await grabRepos(); return a.length ? a.map((r) => `• ${r.name} [${r.visibility}]${r.desc ? ` — ${r.desc}` : ""}`).join("\n") : "No apps found (is gh logged in?)."; } },
  { name: "git_diff", safe: true, description: "Show what changed in a local repo (uncommitted). input: {dir, file?}.", params: "{dir, file?}",
    activity: (i) => `Looking at changes in ${i.dir}`,
    run: (i) => gitIn(i.dir, `diff --stat ${i.file ? shq(i.file) : ""}`).then((s) => s || "No uncommitted changes.") },
  { name: "git_log", safe: true, description: "Show recent commits in a local repo. input: {dir, limit?}.", params: "{dir, limit?}",
    activity: (i) => `Reading recent commits in ${i.dir}`,
    run: (i) => gitIn(i.dir, `log --oneline -n ${Math.min(Number(i?.limit) || 15, 50)}`) },
  { name: "git_branches", safe: true, description: "List branches in a local repo (current marked *). input: {dir}.", params: "{dir}",
    activity: (i) => `Listing branches in ${i.dir}`,
    run: (i) => gitIn(i.dir, "branch -a --sort=-committerdate") },
  { name: "run_script", safe: false, description: "Run an npm script (build/test/lint/etc) in a project. input: {dir, script}.", params: "{dir, script}",
    activity: (i) => `Running npm ${i.script} in ${i.dir}`,
    preview: (i) => `Run \`npm run ${i.script}\` in ${i.dir}`,
    run: (i) => {
      const script = String(i.script || "");
      if (!/^[\w:.-]+$/.test(script)) return Promise.resolve("That doesn't look like a valid npm script name.");
      // Cross-platform: execFile with cwd (no `cd`), shell:true so 'npm' resolves to npm.cmd on Windows;
      // last 40 lines sliced in JS (no `| tail`). Strict script validation blocks shell injection.
      return execFile("npm", ["run", script], { cwd: String(i.dir || "."), timeout: 180000, maxBuffer: 4 * 1024 * 1024, shell: true } as any)
        .then((r: any) => (((r.stdout || "") + (r.stderr || "")).split("\n").slice(-40).join("\n") || "(done)").slice(0, 4000))
        .catch((e: any) => `failed:\n${(((e?.stdout || "") + (e?.stderr || e?.message || e)).toString()).split("\n").slice(-40).join("\n").slice(0, 800)}`);
    } },
  { name: "my_socials", safe: true, description: "Show the user's social profiles/links on file (optionally for one brand). input: {brand?}.", params: "{brand?}",
    activity: () => `Pulling up your socials`,
    run: async (i) => {
      const s = loadSocials(); const keys = Object.keys(s);
      if (!keys.length) return "No socials on file yet. Add handles in vault/socials.json (or ask me to find them).";
      const pick = i?.brand ? keys.filter((k) => k.toLowerCase().includes(String(i.brand).toLowerCase())) : keys;
      return pick.map((k) => { const links = Object.entries(s[k]).filter(([, v]) => v).map(([p, v]) => `${p}: ${v}`).join(" · "); return `${k} — ${links || "no links on file"}`; }).join("\n");
    } },
  // ── Proactive nudges (SAM reminds you — and pings you when due) ──
  { name: "add_nudge", safe: true, description: "Set a reminder/nudge SAM will proactively ping you about. input: {text, when?} (when = ISO date-time, optional).", params: "{text, when?}",
    activity: (i) => `Setting a nudge: “${i.text ?? i}”`,
    run: async (i) => { const n = addNudge(i.text ?? i, i.when || i.due); return `Got it — I'll nudge you${n.due ? ` at ${n.due}` : ""}: “${n.text}”.`; } },
  { name: "list_nudges", safe: true, description: "List your pending nudges/reminders.", params: "(none)",
    activity: () => `Checking your nudges`,
    run: async () => { const l = listNudges(); return l.length ? l.map((n) => `• ${n.text}${n.due ? ` (due ${n.due})` : ""}`).join("\n") : "No pending nudges."; } },
  { name: "complete_nudge", safe: true, description: "Mark a nudge done. input: text or id.", params: "text",
    activity: (_i) => `Ticking off a nudge`,
    run: async (i) => completeNudge(i.text ?? i.id ?? i) },

  // ── File utilities (quick wins) ──
  { name: "move_file", safe: false, description: "Move or rename a file/folder. input: {from, to}.", params: "{from, to}",
    activity: (i) => `Moving ${i.from} → ${i.to}`,
    preview: (i) => `Move / rename:\n${i.from}\n→ ${i.to}`,
    run: (i) => rename(safePath(i.from), safePath(i.to)).then(() => `Moved to ${i.to}`).catch((e: any) => `Couldn't move: ${e?.message}`) },
  { name: "make_folder", safe: false, description: "Create a folder (and any parent folders). input: path.", params: "path",
    activity: (i) => `Creating folder ${i.path ?? i}`,
    preview: (i) => `Create folder: ${i.path ?? i}`,
    run: (i) => (async () => { try { mkdirSync(safePath(i.path ?? i), { recursive: true }); return `Created ${i.path ?? i}`; } catch (e: any) { return `Couldn't: ${e?.message}`; } })() },
  { name: "compress", safe: false, description: "Zip a file or folder. input: {path, out?}.", params: "{path, out?}",
    activity: (i) => `Zipping ${i.path}`,
    preview: (i) => `Zip: ${i.path}`,
    run: (i) => {
      const src = safePath(i.path); const out = safePath(i.out || i.path + ".zip");
      const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;   // PowerShell single-quote escape
      const p = OS === "windows"
        ? execFile("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path ${psq(src)} -DestinationPath ${psq(out)} -Force`])
        : sh(`cd ${shq(dirname(src))} && zip -rq ${shq(out)} ${shq(basename(src))}`);
      return p.then(() => `Zipped to ${out}`).catch((e: any) => `Couldn't zip: ${e?.message}`);
    } },
  { name: "unzip_file", safe: false, description: "Unzip an archive. input: {path, to?}.", params: "{path, to?}",
    activity: (i) => `Unzipping ${i.path}`,
    preview: (i) => `Unzip: ${i.path}`,
    run: (i) => {
      const src = safePath(i.path); const dest = i.to ? safePath(i.to) : dirname(src);
      const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;
      const p = OS === "windows"
        ? execFile("powershell", ["-NoProfile", "-Command", `Expand-Archive -Path ${psq(src)} -DestinationPath ${psq(dest)} -Force`])
        : sh(`unzip -oq ${shq(src)} -d ${shq(dest)}`);
      return p.then(() => `Unzipped ${i.path}`).catch((e: any) => `Couldn't unzip: ${e?.message}`);
    } },
  { name: "directions", safe: true, description: "Open directions / a map lookup. input: {to, from?}.", params: "{to, from?}",
    activity: (i) => `Getting directions to ${i.to ?? i}`,
    run: (i) => { const to = encodeURIComponent(i.to ?? i); const from = i.from ? `&origin=${encodeURIComponent(i.from)}` : ""; return openUrl(`https://www.google.com/maps/dir/?api=1&destination=${to}${from}`).then(() => `Opened directions to ${i.to ?? i}`); } },
  { name: "backup_vault", safe: true, description: "Back up SAM's memory vault to a timestamped folder on the Desktop.", params: "(none)",
    activity: () => `Backing up your SAM memory`,
    run: async () => { const stamp = nowText().replace(/[^0-9]/g, "").slice(0, 12); const dest = safePath(`~/Desktop/sam-vault-backup-${stamp}`); try { await cp(safePath("./vault"), dest, { recursive: true }); return `Backed up your vault to ${dest}`; } catch (e: any) { return `Backup failed: ${e?.message}`; } } },
  // ── People SAM knows by sight ──
  { name: "remember_person", safe: true, description: "Remember a person by sight. input: {name, look, relation?} — look = short description of their appearance.", params: "{name, look, relation?}",
    activity: (i) => `Remembering ${i.name}`,
    run: async (i) => { const p = addPerson(i.name, i.look || "", i.relation); return `Got it — I'll recognise ${p.name}${p.relation ? ` (${p.relation})` : ""} next time I see them.`; } },
  { name: "who_i_know", safe: true, description: "List the people SAM can recognise by sight.", params: "(none)",
    activity: () => `Checking who I know`,
    run: async () => { const l = listPeople(); return l.length ? l.map((p) => `• ${p.name}${p.relation ? ` (${p.relation})` : ""} — ${p.look}`).join("\n") : "I don't know anyone by sight yet. Show me someone and say 'remember this is <name>'."; } },
  { name: "security_check", safe: true, description: "Report SAM's security watchdog — anything dodgy it flagged/blocked (bad commands, unexpected origins), or all-clear.", params: "(none)",
    activity: () => `Running a security check`,
    run: async () => {
      const s = securityStatus();
      if (s.clear) return "🛡️ All clear — nothing dodgy. No blocked commands, no unexpected access. SAM's watching.";
      const lines = s.latest.map((e) => `• [${e.at}] ${e.type}: ${e.detail}${e.source ? ` (from ${e.source})` : ""}`).join("\n");
      return `🛡️ ${s.headline}. ${s.alerts} blocked, ${s.warns} flagged.\nRecent:\n${lines}`;
    } },
  { name: "git_status", safe: true, description: "Show git status of a local repo folder (branch + changed files). input: {dir}.", params: "{dir}",
    activity: (i) => `Checking git status in ${i.dir}`,
    run: (i) => gitIn(i.dir, "status --short --branch") },
  { name: "git_commit", safe: false, description: "Stage ALL changes and commit in a local repo. input: {dir, message, branch?} (branch = create/switch to it first).", params: "{dir, message, branch?}",
    activity: (i) => `Committing in ${i.dir}${i.branch ? ` on ${i.branch}` : ""}`,
    preview: (i) => `Commit ALL current changes in:\n${i.dir}\n${i.branch ? `New branch: ${i.branch}\n` : ""}Message: “${i.message}”`.slice(0, 320),
    run: async (i) => {
      let out = "";
      if (i.branch) out += (await gitIn(i.dir, `checkout -b ${shq(i.branch)}`)) + "\n";
      await gitIn(i.dir, "add -A");
      out += await gitIn(i.dir, `commit -m ${shq(i.message)}`);
      return out.trim();
    } },
  { name: "git_push", safe: false, description: "Push the current branch to origin (GitHub) — publishes your commits. input: {dir}.", params: "{dir}",
    activity: (i) => `Pushing ${i.dir} to GitHub`,
    preview: (i) => `Push the current branch of ${i.dir} to origin (GitHub).\nThis publishes your commits to the remote.`,
    run: async (i) => gitIn(i.dir, `push -u origin ${shq(await currentBranch(i.dir))}`) },
  { name: "github_pr", safe: false, description: "Open a pull request from a local repo's pushed branch. input: {dir, title, body?, base?}.", params: "{dir, title, body?, base?}",
    activity: (i) => `Opening a pull request: “${i.title}”`,
    preview: (i) => `Open a GitHub Pull Request from:\n${i.dir}\nTitle: ${i.title}\nInto: ${i.base || "the default branch"}\n${i.body || ""}`.slice(0, 320),
    run: (i) => sh(`cd ${shq(i.dir)} && gh pr create ${i.base ? `--base ${shq(i.base)} ` : ""}--title ${shq(i.title)} --body ${shq(i.body || " ")}`, { timeout: 30000 })
      .then((r: any) => ((r.stdout || r.stderr || "PR opened").toString()).trim().slice(0, 1000))
      .catch((e: any) => `GitHub: ${(e?.stderr || e?.message || e).toString().slice(0, 300)}`) },
  { name: "system_info", safe: true, description: "Get Mac system info (macOS version, uptime, disk).", params: "(none)",
    activity: () => `Checking your system`, run: systemInfo },
  { name: "speak", safe: true, description: "Speak text aloud through the speakers. input: text.", params: "text",
    activity: () => `Speaking`, run: (i) => speak(i.text ?? i) },
  { name: "play", safe: true, description: "Play/pull up music — a song, artist, latest release, or playlist. input: what to play.", params: "query",
    activity: (i) => `Pulling up ${i.query ?? i}`, run: (i) => playMusic(i.query ?? i) },
  { name: "find_contact", safe: true, description: "Look up a person's phone/email in Contacts. input: a name.", params: "name",
    activity: (i) => `Looking up ${i.name ?? i} in Contacts`, run: (i) => findContact(i.name ?? i) },
  { name: "read_calendar", safe: true, description: "Read today's calendar events.", params: "(none)",
    activity: () => `Checking your calendar`, run: readCalendar },

  { name: "read_emails", safe: true, description: "Read the latest emails in your inbox (senders + subjects).", params: "(none)",
    activity: () => `Checking your inbox`, run: readEmails },

  // risky · ask first
  { name: "run_command", safe: false, description: "Run a shell command on the Mac. input: a command string.", params: "command",
    activity: (_i) => `Running a command`, preview: (i) => `Terminal command:\n  ${i.command ?? i}`, run: (i) => runCommand(i.command ?? i) },
  { name: "write_file", safe: false, description: "Write/overwrite a file. input: {path, content}.", params: "{path, content}",
    activity: (i) => `Saving ${i.path}`, preview: (i) => `Write to ${i.path} (${(i.content||"").length} chars)`, run: (i) => writeFileTool(i) },
  { name: "open_app", safe: false, description: "Open a Mac application. input: app name.", params: "app name",
    activity: (i) => `Opening ${i.app ?? i}`, preview: (i) => `Open app: ${i.app ?? i}`, run: (i) => openApp(i.app ?? i) },
  { name: "type_text", safe: false, description: "Type text via the keyboard into the focused app. input: text.", params: "text",
    activity: () => `Typing`, preview: (i) => `Type into the active app:\n  ${i.text ?? i}`, run: (i) => typeText(i.text ?? i) },
  { name: "press_key", safe: false, description: "Press a key. input: {key: <key code number>, modifiers?: [command|shift|option|control]}.", params: "{key, modifiers?}",
    activity: () => `Pressing a key`, preview: (i) => `Press key code ${i.key}${i.modifiers?` + ${i.modifiers.join("+")}`:""}`, run: (i) => pressKey(i) },
  { name: "click", safe: false, description: "Click the mouse at screen coordinates. input: {x, y}.", params: "{x, y}",
    activity: (_i) => `Clicking the screen`, preview: (i) => `Click at ${i.x}, ${i.y}`, run: (i) => clickAt(i) },
  { name: "applescript", safe: false, description: "Run AppleScript for deep macOS automation (control apps, Messages, Mail, etc). input: script.", params: "script",
    activity: () => `Automating an app`, preview: (i) => `Run AppleScript:\n${i.script ?? i}`, run: (i) => appleScript(i.script ?? i) },
  { name: "clipboard_set", safe: false, description: "Put text on the clipboard. input: text.", params: "text",
    activity: () => `Copying to clipboard`, preview: (i) => `Copy to clipboard:\n  ${i.text ?? i}`, run: (i) => clipboardSet(i.text ?? i) },
  { name: "send_imessage", safe: false, description: "Send an iMessage/text. input: {to, message}.", params: "{to, message}",
    activity: (i) => `Texting ${i.to}`, preview: (i) => `Send iMessage\n  To: ${i.to}\n  ${i.message}`, run: (i) => sendIMessage(i) },
  { name: "read_notes", safe: true, description: "Read the user's recently modified Notes.", params: "(none)",
    activity: () => `Reading Notes`, run: async () => { if (!IS_MAC) return notSupported("Read Notes"); return await readAppleNotes(); } },
  { name: "append_note", safe: false, description: "Append text to a note by title. input: {title, text}.", params: "{title, text}",
    activity: (i) => `Appending to note: ${i.title}`, preview: (i) => `Append to Note '${i.title}':\n${clip(i.text, 100)}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          await osa(`tell application "Notes"\nset n to first note whose name contains "${esc(i.title)}"\nset body HTML of n to (body HTML of n) & "<br><br>${esc(i.text).replace(/\n/g, "<br>")}"\nend tell`);
          return `Appended to note '${i.title}'.`;
        } else {
          const notesDir = resolve(homedir(), "SAM_Notes");
          const nmeHits = await findByName(notesDir, String(i.title), 1); const stdout = nmeHits[0] || "";
          const file = resolve(notesDir, stdout.trim() || `${String(i.title).replace(/[^a-z0-9]/gi, '_')}.txt`);
          await appendFileFs(file, `\n\n${i.text}`, "utf8");   // fs write — no shell, no injection
          return `Appended to ${file}.`;
        }
      } catch (e: any) { return `Couldn't append to note: ${e.message}`; }
    } },
  { name: "read_reminders", safe: true, description: "Read pending Reminders.", params: "(none)",
    activity: () => `Checking Reminders`, run: async () => { if (!IS_MAC) return notSupported("Reminders"); return await readReminders(); } },
  { name: "browser_navigate", safe: false, description: "Open a Chrome browser tab and navigate to a URL. Returns page title.", params: "url",
    activity: (i) => `Navigating to ${i.url ?? i}`, preview: (i) => `Browser: Go to ${i.url ?? i}`, run: (i) => browserNavigate(i.url ?? i) },
  { name: "browser_read", safe: true, description: "Read the visible text from the currently open Chrome tab.", params: "(none)",
    activity: () => `Reading active browser tab`, run: browserRead },
  { name: "browser_click", safe: false, description: "Click an element in the active Chrome tab using a CSS selector.", params: "selector",
    activity: (i) => `Clicking ${i.selector ?? i}`, preview: (i) => `Browser: Click '${i.selector ?? i}'`, run: (i) => browserClick(i.selector ?? i) },
  { name: "browser_type", safe: false, description: "Type text into an element in the active Chrome tab. input: {selector, text, submit?}.", params: "{selector, text, submit?}",
    activity: (i) => `Typing into ${i.selector}`, preview: (i) => `Browser: Type into '${i.selector}'\n${i.text}`, run: (i) => browserType(i) },
  { name: "add_reminder", safe: false, description: "Add a new Reminder. input: {text, list?}. list defaults to 'Reminders'.", params: "{text, list?}",
    activity: (i) => `Adding reminder: ${i.text}`, preview: (i) => `Add Reminder to ${i.list || 'Reminders'}:\n${i.text}`,
    run: async (i) => {
      if (!IS_MAC) return notSupported("Reminders");
      try {
        const l = i.list || "Reminders";
        await osa(`tell application "Reminders"\ntell list "${esc(l)}"\nmake new reminder with properties {name:"${esc(i.text)}"}\nend tell\nend tell`);
        return `Added reminder '${i.text}'.`;
      } catch (e: any) { return `Couldn't add reminder: ${e.message}`; }
    } },
  { name: "read_email", safe: true, description: "Read unread emails from the inbox. Returns the sender, subject, date, and body snippet. input: {limit?: number}.", params: "{limit}",
    activity: () => `Checking inbox`,
    run: async (i) => {
      if (!IS_MAC) return notSupported("Read Mail");
      const limit = i.limit || 5;
      const script = `tell application "Mail"\nset unreadMsgs to (messages of inbox whose read status is false)\nset out to ""\nset counter to 0\nrepeat with msg in unreadMsgs\nif counter is ${limit} then exit repeat\nset out to out & "---" & return\nset out to out & "From: " & sender of msg & return\nset out to out & "Subject: " & subject of msg & return\nset out to out & "Date: " & date sent of msg & return\nset bodyText to content of msg\nif (length of bodyText) > 500 then\nset out to out & "Body: " & (text 1 thru 500 of bodyText) & "..." & return\nelse\nset out to out & "Body: " & bodyText & return\nend if\nset counter to counter + 1\nend repeat\nif out is "" then return "No unread emails."\nreturn out\nend tell`;
      try { return await osa(script); } catch (e: any) { return `Failed to read Mail: ${e.message}`; }
    } },
  { name: "draft_email", safe: false, description: "Draft a new email. input: {recipient, subject, body}.", params: "{recipient, subject, body}",
    activity: (i) => `Drafting email to ${i.recipient}`, preview: (i) => `To: ${i.recipient}\nSubject: ${i.subject}\n\n${i.body}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const script = `tell application "Mail"\nset newMsg to make new outgoing message with properties {subject:"${esc(i.subject)}", content:"${esc(i.body)}", visible:true}\ntell newMsg\nmake new to recipient at end of to recipients with properties {address:"${esc(i.recipient)}"}\nend tell\nactivate\nend tell`;
          await osa(script); return "Draft created and opened in Apple Mail.";
        } else {
          await openUrl(`mailto:${i.recipient}?subject=${encodeURIComponent(i.subject)}&body=${encodeURIComponent(i.body)}`);
          return `Opened email draft in default client.`;
        }
      } catch (e: any) { return `Failed to draft Mail: ${e.message}`; }
    } },
  { name: "run_shortcut", safe: false, description: "Run a native OS Shortcut/script by name. input: {name}.", params: "{name}",
    activity: (i) => `Running Shortcut: ${i.name}`, preview: (i) => `Run Shortcut:\n${i.name}`,
    run: async (i) => {
      if (!IS_MAC) return notSupported("Shortcuts");
      try {
        const { stdout } = await sh(`shortcuts run ${shq(i.name)}`);
        return stdout || `Ran shortcut '${i.name}'.`;
      } catch (e: any) { return `Shortcut failed: ${e.message}`; }
    } },
  { name: "list_shortcuts", safe: true, description: "List all available OS Shortcuts.", params: "(none)",
    activity: () => `Listing available Shortcuts`,
    run: async () => {
      if (!IS_MAC) return notSupported("Shortcuts");
      try { const { stdout } = await sh("shortcuts list"); return stdout; } catch (e: any) { return `Failed: ${e.message}`; }
    } },
  { name: "media_control", safe: false, description: "Control media playback (play/pause, next, previous). input: {action: 'playpause' | 'next' | 'prev'}.", params: "{action}",
    activity: (i) => `Controlling media (${i.action})`, preview: (i) => `Media: ${i.action}`,
    run: async (i) => {
      try {
        if (IS_MAC) {
          const key = i.action === "next" ? 101 : i.action === "prev" ? 98 : 100;
          await osa(`tell application "System Events" to key code ${key}`);
        } else if (OS === "windows") {
          const key = i.action === "next" ? "^{MEDIA_NEXT_TRACK}" : i.action === "prev" ? "^{MEDIA_PREV_TRACK}" : "^{MEDIA_PLAY_PAUSE}";
          await sh(`powershell -c "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('${key}')"`);
        } else {
          const key = i.action === "next" ? "next" : i.action === "prev" ? "previous" : "play-pause";
          await sh(`playerctl ${key}`);
        }
        return `Triggered ${i.action}.`;
      } catch (e: any) { return `Failed: ${e.message}`; }
    } },
  { name: "append_file", safe: false, description: "Append text to a file (e.g. a notes/log). input: {path, content}.", params: "{path, content}",
    activity: (i) => `Adding to ${i.path}`, preview: (i) => `Append to ${i.path}:\n${i.content}`, run: (i) => appendFile(i) },
  { name: "trash_file", safe: false, description: "Move a file to the Trash (recoverable). input: path.", params: "path",
    activity: (i) => `Trashing ${i.path ?? i}`, preview: (i) => `Move to Trash: ${i.path ?? i}`, run: (i) => moveToTrash(i.path ?? i) },
  { name: "set_volume", safe: false, description: "Set the system volume 0-100. input: level.", params: "level",
    activity: (_i) => `Setting volume`, preview: (i) => `Set volume to ${i.level ?? i}%`, run: (i) => setVolume(i.level ?? i) },
  { name: "music", safe: false, description: "Control Apple Music. input: {action: play|pause|next|previous}.", params: "{action}",
    activity: (i) => `Music: ${i.action ?? i}`, preview: (i) => `Music control: ${i.action ?? i}`, run: (i) => musicControl(i.action ?? i) },
  { name: "call", safe: false, description: "Place a phone call through your iPhone (Continuity). input: a phone number.", params: "number",
    activity: (i) => `Calling ${i.number ?? i}`, preview: (i) => `📞 Call ${i.number ?? i}`, run: (i) => makeCall(i.number ?? i) },
  { name: "facetime", safe: false, description: "Start a FaceTime call. input: a phone number, email, or contact.", params: "who",
    activity: (i) => `FaceTiming ${i.who ?? i}`, preview: (i) => `FaceTime ${i.who ?? i}`, run: (i) => faceTime(i.who ?? i) },
  { name: "remember_fact", safe: true, description: "Explicitly save a core fact (preference, detail, rule) into SAM's long-term semantic vault. input: {fact}.", params: "{fact}",
    activity: () => `Storing fact in semantic memory`, run: async (i) => (await remember(i.fact)) ? "Fact saved." : "Fact ignored (too short or duplicate)." },
  { name: "search_memory", safe: true, description: "Search the semantic vault for a specific topic, returning the raw facts and their IDs. input: {query}.", params: "{query}",
    activity: (i) => `Searching memory for "${i.query}"`, run: async (i) => {
      const results = await recall(i.query, 10, 0.2);
      if (!results.length) return "No matching memories found.";
      return results.map(r => `[ID: ${r.id}] ${r.text} (score: ${r.score.toFixed(2)})`).join("\n");
    } },
  { name: "list_recent_memories", safe: true, description: "Pull the last 10 facts added to the vault chronologically. input: (none).", params: "(none)",
    activity: () => `Listing recent memories`, run: async () => {
      const recent = listRecent(10);
      if (!recent.length) return "Vault is empty.";
      return recent.map(r => `[ID: ${r.id}] ${new Date(r.ts).toLocaleString()}: ${r.text}`).join("\n");
    } },
  { name: "forget_memory", safe: false, description: "Delete a specific memory by its unique ID. input: {id}.", params: "{id}",
    activity: (i) => `Forgetting memory ${i.id}`, preview: (i) => `Permanently delete memory ${i.id}?`, run: async (i) => forget(i.id) ? `Deleted memory ${i.id}.` : `Memory ${i.id} not found.` },
  { name: "clear_all_memories", safe: false, description: "NUCLEAR OPTION: Wipes the entire semantic memory vault clean.", params: "(none)",
    activity: () => `Wiping memory vault`, preview: () => `Wipe entire memory vault?`, run: async () => { clearAll(); return "Memory vault wiped clean."; } },
  { name: "ingest_folder", safe: false, description: "Index every readable document in a folder (recursively — md/txt/pdf/docx/csv/json/html) into SAM's document library so SAM knows their contents and can recall them by meaning. Re-running skips unchanged files. input: {path, max_files?}.", params: "{path, max_files?}",
    activity: (i) => `Indexing documents in ${i.path ?? i}`,
    preview: (i) => `Scan ${i.path ?? i} and index its documents into SAM's library (uses free embedding quota; unchanged files are skipped; ~${Number(i.max_files) || 300} files max this run)`,
    run: async (i) => reportText(await ingestFolder(i.path ?? i, Number(i.max_files) || 300)) },
  { name: "search_docs", safe: true, description: "Search the user's ingested document library by meaning — returns the best-matching passages with their source files. input: {query}.", params: "{query}",
    activity: (i) => `Searching your documents for "${i.query ?? i}"`, run: async (i) => {
      const hits = await searchDocs(i.query ?? i);
      if (!hits.length) return docsStats().chunks ? "No matching passages in the document library." : "The document library is empty — ingest a folder first (ingest_folder).";
      return hits.map((h) => `[${h.source}] (${h.score.toFixed(2)})\n${h.text}`).join("\n\n");
    } },
  { name: "docs_library", safe: true, description: "Show what's in SAM's document library — counts + the most recently indexed files. input: (none).", params: "(none)",
    activity: () => `Checking the document library`, run: async () => {
      const s = docsStats();
      if (!s.files) return "The document library is empty. Point me at a folder and I'll learn it (ingest_folder).";
      const recent = recentDocs(12).map((r) => `- ${r.path} (${r.chunks} chunks, ${new Date(r.ts).toLocaleDateString()})`).join("\n");
      return `${s.files} files · ${s.chunks} searchable chunks.\nMost recent:\n${recent}`;
    } },
  { name: "forget_docs", safe: false, description: "Remove a file or a whole folder from SAM's document library. input: {path}.", params: "{path}",
    activity: (i) => `Removing ${i.path ?? i} from the library`, preview: (i) => `Forget everything indexed under ${i.path ?? i}?`,
    run: async (i) => { const n = forgetDoc(i.path ?? i); return n ? `Forgot ${n} indexed chunk(s) under ${i.path ?? i}.` : `Nothing in the library under ${i.path ?? i}.`; } },
  // ── THE LIFE INDEX (Phase 3) — folders the user chooses, kept fresh automatically ──
  { name: "watch_folder", safe: false, description: "Add a folder to SAM's LIFE INDEX: index it now AND keep it auto-updated as files change (file-watcher, paused on battery). Like watch_folder for your whole world. input: {path}.", params: "{path}",
    activity: (i) => `Adding ${i.path ?? i} to your life index`, preview: (i) => `Index ${i.path ?? i} and keep it live-updated as its files change (local only; nothing leaves your Mac)`,
    run: async (i) => { const { report } = await addFolder(i.path ?? i); return report ? reportText(report) + " Now watching it for changes." : `Added ${i.path ?? i} to the life index (indexing paused — on battery or busy; it'll catch up when plugged in).`; } },
  { name: "unwatch_folder", safe: false, description: "Remove a folder from SAM's life index — stops watching it and forgets its contents. input: {path}.", params: "{path}",
    activity: (i) => `Removing ${i.path ?? i} from your life index`, preview: (i) => `Stop watching ${i.path ?? i} and forget everything indexed under it?`,
    run: async (i) => { const r = removeFolder(i.path ?? i); return r.removed ? `Stopped watching ${i.path ?? i} and forgot ${r.forgotten} chunk(s).` : `${i.path ?? i} isn't in the life index.`; } },
  { name: "life_index", safe: true, description: "Show SAM's life index — which of your folders are indexed and watched for changes. input: (none).", params: "(none)",
    activity: () => `Checking your life index`, run: async () => {
      const s = lifeIndexStats(); const folders = listFolders();
      if (!folders.length) return "Your life index is empty. Pick a folder (Documents, Desktop, a projects dir) with watch_folder and I'll learn it and keep it fresh.";
      return `${s.folders} folder(s) in your life index · watching: ${s.watching ? "on" : "off"} (${s.watchers} live)\n` +
        folders.map((f) => `- ${f.path}${f.lastIndexedAt ? ` (last indexed ${new Date(f.lastIndexedAt).toLocaleString()})` : " (not indexed yet)"}`).join("\n");
    } },
  { name: "ask_about", safe: true, description: "Answer a question grounded ONLY in a specific file or folder from your indexed library, citing the source files. input: {path, question}.", params: "{path, question}",
    activity: (i) => `Reading your ${(i.path ?? "").split("/").pop() || "files"} to answer that`, run: async (i) => {
      const { answer, sources } = await askAbout(i.path ?? "", i.question ?? "");
      return sources.length ? `${answer}\n\nSources: ${sources.map((s: string) => s.split("/").pop()).join(", ")}` : answer;
    } },
  { name: "add_schedule", safe: false, description: "Create a recurring background task. input: {command, cron} (cron: 'hourly', 'every 30m', 'daily 09:00', 'weekly mon 09:00').", params: "{command, cron}",
    activity: () => `Adding scheduled task`, preview: (i) => `Set up a recurring task — run "${i.command}" ${i.cron}?`, run: async (i) => { const s = addSchedule(i.command, i.cron); return `Scheduled '${s.command}' to run ${s.cron} (ID: ${s.id}).`; } },
  { name: "list_schedules", safe: true, description: "List all active background routines and scheduled tasks SAM is maintaining.", params: "(none)",
    activity: () => `Listing schedules`, run: async () => {
      const list = listSchedules();
      if (!list.length) return "No active schedules.";
      return list.map(s => `[${s.id}] ${s.cron} | ${s.command} | runs: ${s.runCount} | enabled: ${s.enabled} | last: ${s.lastResult || "never"}`).join("\n");
    } },
  { name: "remove_schedule", safe: false, description: "Delete a specific scheduled task by ID. input: {id}.", params: "{id}",
    activity: (i) => `Removing schedule ${i.id}`, preview: (i) => `Delete scheduled task ${i.id}?`, run: async (i) => removeSchedule(i.id) ? `Removed schedule ${i.id}.` : `Schedule ${i.id} not found.` },
  { name: "toggle_schedule", safe: true, description: "Pause or resume a scheduled task by ID. input: {id}.", params: "{id}",
    activity: (i) => `Toggling schedule ${i.id}`, run: async (i) => { const s = toggleSchedule(i.id); return s ? `Schedule ${s.id} is now ${s.enabled ? "enabled" : "paused"}.` : `Schedule ${i.id} not found.`; } },
  { name: "start_swarm", safe: true, description: "Spin up a continuous background Swarm of agents for a massive, multi-step task. input: {goal, system}.", params: "{goal, system}",
    activity: () => `Spawning Swarm`, run: async (i) => { const s = await startSwarm(i.goal, i.system, "free"); return `Swarm '${s.id}' launched. Run list_swarms to check status.`; } },
  { name: "list_swarms", safe: true, description: "List all active or completed background Swarms.", params: "(none)",
    activity: () => `Listing Swarms`, run: async () => {
      const swarms = loadSwarms();
      if (!swarms.length) return "No swarms exist.";
      return swarms.map(s => `[${s.id}] ${s.goal} | status: ${s.status} | agents: ${s.agents.length}`).join("\n");
    } },
  { name: "list_projects", safe: true, description: "List all active brands, projects, and concepts SAM is managing.", params: "(none)",
    activity: () => `Reading Project Registry`, run: async () => {
      if (!PROJECTS.length) return "No projects in registry.";
      return PROJECTS.map(p => `[${p.id}] ${p.name} (${p.status}) - ${p.summary}`).join("\n");
    } },
  { name: "manage_api_keys", safe: false, description: "Add or update an API key in SAM's .env file. input: {provider, key}. Providers: ANTHROPIC, OPENAI, GEMINI, GROQ, etc.", params: "{provider, key}",
    activity: (i) => `Updating ${i.provider} API key`, preview: (i) => `Save ${i.provider} API key to .env?`, run: async (i) => {
      try {
        const fs = await import("node:fs/promises");
        const envPath = resolve(process.cwd(), ".env");
        let content = "";
        try { content = await fs.readFile(envPath, "utf8"); } catch {}
        const varName = `${i.provider.toUpperCase()}_API_KEYS`;
        const regex = new RegExp(`^${varName}=.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, `${varName}=${i.key}`);
        } else {
          content += `\n${varName}=${i.key}\n`;
        }
        await fs.writeFile(envPath, content.trim() + "\n", "utf8");
        return `Saved ${varName} to .env. IMPORTANT: Please restart SAM for the new keys to be loaded into the pools.`;
      } catch (e: any) { return `Failed to update .env: ${e.message}`; }
    } },
  // ─── ADMIN SUITE ────────────────────────────────────────────────────────────
  { name: "manage_autopilot", safe: false, description: "Turn SAM's autopilot mode on or off. When on, SAM runs low-risk tools without asking. input: {action: 'on' | 'off' | 'status'}.", params: "{action}",
    activity: (i) => `Autopilot: ${i.action}`, preview: (i) => i.action === "off" ? `Turn OFF autopilot — SAM will ask permission for every action?` : `Turn ON autopilot — SAM runs safe tools without asking?`,
    run: async (i) => {
      if (i.action === "status") return `Autopilot is currently ${autopilotOn() ? "ON ✅" : "OFF 🔴"}.`;
      if (i.action === "on") { setAutopilot(true); return "Autopilot is now ON. SAM will handle safe tasks autonomously."; }
      if (i.action === "off") { setAutopilot(false); return "Autopilot is now OFF. SAM will ask before every action."; }
      return `Unknown action '${i.action}'. Use: on, off, or status.`;
    } },
  { name: "manage_authorizations", safe: false, description: "View, grant, or revoke SAM's standing 'always allow' permissions for specific tools. input: {action: 'list' | 'grant' | 'revoke', tool?: string}.", params: "{action, tool?}",
    activity: (i) => `Permissions: ${i.action} ${i.tool ?? ""}`.trim(), preview: (i) => i.action === "revoke" ? `Revoke permanent permission for '${i.tool}'?` : `Grant permanent permission for '${i.tool}'?`,
    run: async (i) => {
      if (i.action === "list") {
        const tools = listAllowed();
        return tools.length ? `Always-allowed tools:\n${tools.map((t: string) => `  • ${t}`).join("\n")}` : "No tools are permanently authorized — SAM asks for every action.";
      }
      if (!i.tool) return "Please specify a tool name.";
      if (i.action === "grant") { allow(i.tool); return `Granted permanent permission for '${i.tool}'.`; }
      if (i.action === "revoke") { disallow(i.tool); return `Revoked permanent permission for '${i.tool}'.`; }
      return `Unknown action '${i.action}'. Use: list, grant, or revoke.`;
    } },
  { name: "stop_swarm", safe: false, description: "Emergency kill-switch for a running Swarm. Immediately halts all agents. input: {id}.", params: "{id}",
    activity: (i) => `Killing swarm ${i.id}`, preview: (i) => `KILL swarm ${i.id}? All running agents will be stopped immediately.`,
    run: async (i) => stopSwarm(i.id) ? `Swarm '${i.id}' has been killed. All agents halted.` : `Swarm '${i.id}' not found.` },
  { name: "self_restart", safe: false, description: "Cleanly restart SAM's server process. Useful after updating API keys or source code. input: (none).", params: "(none)",
    activity: () => `Restarting SAM...`, preview: () => `Restart SAM's server process now?`,
    run: async () => {
      setTimeout(() => process.exit(0), 500);
      return "SAM is restarting... I'll be back in a moment. 👋";
    } },
  { name: "kill_process", safe: false, description: "Force quit a misbehaving app or process by name. input: {process_name}.", params: "{process_name}",
    activity: (i) => `Killing process ${i.process_name}`, preview: (i) => `Force quit ${i.process_name}?`, run: async (i) => {
      try {
        await sh(`pkill -i -f ${shq(i.process_name)}`);
        return `Terminated process matching "${i.process_name}".`;
      } catch (e: any) { return `Failed to kill (or not found): ${e.message}`; }
    } },
  { name: "kill_port", safe: false, description: "Instantly kill whatever is blocking a specific port. input: {port}.", params: "{port}",
    activity: (i) => `Killing port ${i.port}`, preview: (i) => `Kill process on port ${i.port}?`, run: async (i) => {
      try {
        await sh(`lsof -ti:${Number(i.port)} | xargs kill -9`);
        return `Killed process on port ${i.port}.`;
      } catch (e: any) { return `Failed (port might be empty): ${e.message}`; }
    } },
  { name: "local_ocr", safe: true, description: "Extract text from a local image file. input: {image_path}.", params: "{image_path}",
    activity: () => `Extracting text from image`, run: async (i) => {
      try {
        const { stdout } = await sh(`macocr ${shq(i.image_path)}`);
        return stdout.trim() || "No text found.";
      } catch (e: any) { return `OCR failed. If macOCR isn't installed, run: brew install schappim/macocr/macocr\nError: ${e.message}`; }
    } },
  // ─── ADMIN: VAULT ─────────────────────────────────────────────────────────
  { name: "vault_status", safe: true, description: "Show the Obsidian vault stats: daily note count, project note count, disk path, and recent log entries.", params: "(none)",
    activity: () => `Checking vault status`, run: async () => {
      const s = vaultStats();
      const log = recentLog(5);
      const lines = [`📁 Vault: ${s.path}`, `  • Daily notes: ${s.dailyNotes}`, `  • Project notes: ${s.projectNotes}`];
      if (log.length) { lines.push("", "Recent log entries:"); log.forEach((l) => lines.push(`  ${l.time}  ${l.msg}`)); }
      return lines.join("\n");
    } },
  { name: "read_today_log", safe: true, description: "Read today's conversation log from the vault.", params: "(none)",
    activity: () => `Reading today's vault log`, run: async () => {
      const entries = recentLog(20);
      if (!entries.length) return "Nothing logged today yet.";
      return entries.map((l) => `${l.time}  ${l.msg}`).join("\n");
    } },
  { name: "prune_vault", safe: false, description: "Manually purge daily log files older than SAM_LOG_DAYS (default 90 days).", params: "(none)",
    activity: () => `Pruning old vault logs`, preview: () => `Delete vault daily notes older than 90 days?`,
    run: async () => { const r = pruneOldLogs(); return `Pruned ${r.removed} old log file${r.removed !== 1 ? "s" : ""}.`; } },
  // ─── ADMIN: KEY POOL HEALTH ────────────────────────────────────────────────
  // ── 📸 STOCK MEDIA + assets — real footage/photos/GIFs/film data (free tiers) ──
  { name: "stock_photo", safe: true, description: "Find REAL stock photos (free, commercial-ok) via Pexels or Pixabay. input: {query, count?}.", params: "{query, count?}",
    activity: (i) => `Finding stock photos: ${i.query ?? i}`, run: async (i) => {
      const q = String(i.query ?? i ?? "").trim(); if (!q) return "What photos are you after?";
      const n = Math.min(8, Math.max(1, Number(i.count) || 4));
      const px = process.env.PEXELS_API_KEY;
      if (px) { try { const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n}`, { headers: { Authorization: px }, signal: AbortSignal.timeout(15000) }); if (r.ok) { const d: any = await r.json(); const ph = (d.photos || []).map((p: any) => p.src?.large2x || p.src?.large).filter(Boolean); if (ph.length) return `📸 ${ph.length} photos (Pexels):\n` + ph.map((u: string) => `![photo](${u})`).join("\n"); } } catch {} }
      const pb = process.env.PIXABAY_API_KEY;
      if (pb) { try { const r = await fetch(`https://pixabay.com/api/?key=${pb}&q=${encodeURIComponent(q)}&per_page=${n}&image_type=photo`, { signal: AbortSignal.timeout(15000) }); if (r.ok) { const d: any = await r.json(); const ph = (d.hits || []).map((h: any) => h.largeImageURL || h.webformatURL).filter(Boolean); if (ph.length) return `📸 ${ph.length} photos (Pixabay):\n` + ph.map((u: string) => `![photo](${u})`).join("\n"); } } catch {} }
      return "To search real stock photos, add a free Pexels or Pixabay key in Settings → Media.";
    } },
  { name: "stock_video", safe: true, description: "Find REAL stock video / b-roll (free) via Pexels or Pixabay. input: {query, count?}.", params: "{query, count?}",
    activity: (i) => `Finding b-roll: ${i.query ?? i}`, run: async (i) => {
      const q = String(i.query ?? i ?? "").trim(); if (!q) return "What footage do you need?";
      const n = Math.min(6, Math.max(1, Number(i.count) || 3));
      const px = process.env.PEXELS_API_KEY;
      if (px) { try { const r = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${n}`, { headers: { Authorization: px }, signal: AbortSignal.timeout(15000) }); if (r.ok) { const d: any = await r.json(); const vids = (d.videos || []).map((v: any) => v.video_files?.find((f: any) => f.quality === "hd")?.link || v.video_files?.[0]?.link).filter(Boolean); if (vids.length) return `🎬 ${vids.length} clips (Pexels):\n` + vids.map((u: string) => u).join("\n"); } } catch {} }
      const pb = process.env.PIXABAY_API_KEY;
      if (pb) { try { const r = await fetch(`https://pixabay.com/api/videos/?key=${pb}&q=${encodeURIComponent(q)}&per_page=${n}`, { signal: AbortSignal.timeout(15000) }); if (r.ok) { const d: any = await r.json(); const vids = (d.hits || []).map((h: any) => h.videos?.large?.url || h.videos?.medium?.url).filter(Boolean); if (vids.length) return `🎬 ${vids.length} clips (Pixabay):\n` + vids.join("\n"); } } catch {} }
      return "To search real b-roll, add a free Pexels or Pixabay key in Settings → Media.";
    } },
  { name: "find_gif", safe: true, description: "Find a GIF via GIPHY (free). input: {query}.", params: "{query}",
    activity: (i) => `Finding a GIF: ${i.query ?? i}`, run: async (i) => {
      const q = String(i.query ?? i ?? "").trim(); if (!q) return "What GIF?";
      const k = process.env.GIPHY_API_KEY; if (!k) return "Add a free GIPHY key in Settings → Media to search GIFs.";
      try { const r = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${k}&q=${encodeURIComponent(q)}&limit=3`, { signal: AbortSignal.timeout(12000) }); if (r.ok) { const d: any = await r.json(); const g = (d.data || []).map((x: any) => x.images?.original?.url).filter(Boolean); if (g.length) return g.map((u: string) => `![gif](${u})`).join("\n"); } } catch {}
      return "Couldn't find a GIF for that.";
    } },
  { name: "movie_info", safe: true, description: "Look up a film/TV show — plot, year, rating, poster — via TMDb or OMDb (free). input: {title}.", params: "{title}",
    activity: (i) => `Looking up “${i.title ?? i}”`, run: async (i) => {
      const t = String(i.title ?? i ?? "").trim(); if (!t) return "Which title?";
      const tmdb = process.env.TMDB_API_KEY;
      if (tmdb) { try { const r = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${tmdb}&query=${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(12000) }); if (r.ok) { const d: any = await r.json(); const m = d.results?.[0]; if (m) return `🎬 **${m.title || m.name}** (${(m.release_date || m.first_air_date || "").slice(0, 4)}) · ⭐ ${m.vote_average}\n${m.overview || ""}${m.poster_path ? `\n\n![poster](https://image.tmdb.org/t/p/w500${m.poster_path})` : ""}`; } } catch {} }
      const omdb = process.env.OMDB_API_KEY;
      if (omdb) { try { const r = await fetch(`https://www.omdbapi.com/?apikey=${omdb}&t=${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(12000) }); if (r.ok) { const m: any = await r.json(); if (m.Title) return `🎬 **${m.Title}** (${m.Year}) · ⭐ ${m.imdbRating}\n${m.Plot || ""}${m.Poster && m.Poster !== "N/A" ? `\n\n![poster](${m.Poster})` : ""}`; } } catch {} }
      return "Add a free TMDb or OMDb key in Settings → Media to look up films.";
    } },

  { name: "generate_image", safe: true, description: "Create an image from a text description — FREE (rotating free lanes, no key needed). Returns the image inline. input: {prompt, width?, height?}.", params: "{prompt, width?, height?}",
    activity: (i) => `Painting: ${String(i.prompt || "").slice(0, 40)}…`, run: async (i) => {
      const prompt = String(i.prompt || i || "").trim();
      if (!prompt) return "Give me a description of the image you want.";
      const w = Math.min(2048, Math.max(256, Number(i.width) | 0 || 1024));
      const h = Math.min(2048, Math.max(256, Number(i.height) | 0 || 1024));
      const done = (url: string, via: string) => `Here you go:\n\n![${prompt.slice(0, 80)}](${url})\n\n(Free — made via ${via}. Right-click to save; want a variation? Just ask.)`;
      // LANE 1 · Pollinations — free, NO key, effectively unlimited. Always first: never
      // spend anyone's free credits while an unlimited no-key lane works.
      const seed = Math.floor(Math.random() * 1e9);
      const pUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 500))}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
      try {
        // Any response = the host is up (some CDNs answer HEAD with 405 but serve the GET fine).
        // Only a real network error/timeout falls through — so we never burn paid credits when
        // the free lane is reachable. The browser does the actual GET that renders the image.
        await fetch(pUrl, { method: "HEAD", signal: AbortSignal.timeout(20000) });
        return done(pUrl, "Pollinations");
      } catch { /* network error only → try the keyed lanes */ }
      // ── CLOUDFLARE Workers AI · FLUX.1-schnell — up to ~100k images/DAY free (account id + token) ──
      const cfAcct = process.env.CLOUDFLARE_ACCOUNT_ID, cfTok = process.env.CLOUDFLARE_API_TOKEN;
      if (cfAcct && cfTok) {
        try {
          const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAcct}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfTok}` }, signal: AbortSignal.timeout(45000),
            body: JSON.stringify({ prompt: prompt.slice(0, 2000), steps: 6 }),
          });
          if (r.ok) { const d: any = await r.json(); const b64 = d?.result?.image; if (b64) return done(`data:image/jpeg;base64,${b64}`, "Cloudflare FLUX"); }
        } catch { /* fall through */ }
      }
      // KEYED LANES · rotate smartly (Oliver Twist — sip each provider's free credits evenly).
      // A comprehensive free FLUX/SD matrix — SAM hops across whichever you've connected.
      type ImgLane = { id: string; make: (key: string) => Promise<string | null> };
      const dataUri = (b64: string, mime = "image/png") => `data:${mime};base64,${b64}`;
      const LANES: ImgLane[] = [
        { id: "huggingface", make: async (k) => {   // FLUX.1-schnell via HF Inference (returns image bytes)
          const r = await fetch("https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ inputs: prompt.slice(0, 800) }),
          });
          if (!r.ok) { reportFailure("huggingface", k, r.status); return null; }
          const ct = r.headers.get("content-type") || ""; if (!ct.startsWith("image")) return null;
          reportSuccess("huggingface", k); return dataUri(Buffer.from(await r.arrayBuffer()).toString("base64"), ct.split(";")[0]);
        } },
        { id: "nvidia", make: async (k) => {   // FLUX.1-schnell via NVIDIA (base64 artifacts)
          const r = await fetch("https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-schnell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}`, Accept: "application/json" }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ prompt: prompt.slice(0, 500), width: Math.min(w, 1024), height: Math.min(h, 1024), steps: 4, seed: Math.floor(Math.random() * 1e6) }),
          });
          if (!r.ok) { reportFailure("nvidia", k, r.status); return null; }
          const d: any = await r.json(); const b64 = d?.artifacts?.[0]?.base64 || d?.image; if (b64) { reportSuccess("nvidia", k); return dataUri(b64); } return null;
        } },
        { id: "deepinfra", make: async (k) => {   // FLUX-1-schnell
          const r = await fetch("https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-1-schnell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ prompt: prompt.slice(0, 800) }),
          });
          if (!r.ok) { reportFailure("deepinfra", k, r.status); return null; }
          const d: any = await r.json(); const u = d?.images?.[0] || d?.image_url; if (u) { reportSuccess("deepinfra", k); return u; } return null;
        } },
        { id: "fal", make: async (k) => {   // FLUX schnell (synchronous)
          const r = await fetch("https://fal.run/fal-ai/flux/schnell", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Key ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ prompt: prompt.slice(0, 800), image_size: h > w ? "portrait_16_9" : w > h ? "landscape_16_9" : "square_hd" }),
          });
          if (!r.ok) { reportFailure("fal", k, r.status); return null; }
          const u = (await r.json())?.images?.[0]?.url; if (u) reportSuccess("fal", k); return u || null;
        } },
        { id: "leonardo", make: async (k) => {   // Leonardo.Ai — async (submit + poll); $5 free credit
          const sub = await fetch("https://cloud.leonardo.ai/api/rest/v1/generations", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ prompt: prompt.slice(0, 800), num_images: 1, width: Math.min(w, 1024), height: Math.min(h, 1024) }),
          });
          if (!sub.ok) { reportFailure("leonardo", k, sub.status); return null; }
          const id = (await sub.json())?.sdGenerationJob?.generationId; if (!id) return null;
          for (let t = 0; t < 20; t++) {
            await new Promise((r) => setTimeout(r, 3000));
            const st = await fetch(`https://cloud.leonardo.ai/api/rest/v1/generations/${id}`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000) });
            if (!st.ok) continue;
            const g: any = await st.json(); const img = g?.generations_by_pk?.generated_images?.[0]?.url;
            if (img) { reportSuccess("leonardo", k); return img; }
            if (g?.generations_by_pk?.status === "FAILED") return null;
          }
          return null;
        } },
        { id: "together", make: async (k) => {   // FLUX.1-schnell free model
          const r = await fetch("https://api.together.xyz/v1/images/generations", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ model: "black-forest-labs/FLUX.1-schnell-Free", prompt: prompt.slice(0, 500), width: Math.min(w, 1440), height: Math.min(h, 1440), steps: 4, n: 1 }),
          });
          if (!r.ok) { reportFailure("together", k, r.status); return null; }
          const u = (await r.json())?.data?.[0]?.url; if (u) reportSuccess("together", k); return u || null;
        } },
        { id: "siliconflow", make: async (k) => {   // Kwai-Kolors / SD — free tier
          const r = await fetch("https://api.siliconflow.cn/v1/images/generations", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(60000),
            body: JSON.stringify({ model: "Kwai-Kolors/Kolors", prompt: prompt.slice(0, 500), image_size: `${Math.min(w, 1024)}x${Math.min(h, 1024)}`, num_inference_steps: 20 }),
          });
          if (!r.ok) { reportFailure("siliconflow", k, r.status); return null; }
          const u = (await r.json())?.images?.[0]?.url; if (u) reportSuccess("siliconflow", k); return u || null;
        } },
      ];
      const avail = LANES.filter((l) => poolSize(l.id) > 0);
      const start = Math.floor(Math.random() * Math.max(1, avail.length));   // spread credit use
      for (let n = 0; n < avail.length; n++) {
        const lane = avail[(start + n) % avail.length];
        const k = getKey(lane.id); if (!k) continue;
        try { const u = await lane.make(k); if (u) return done(u, lane.id); } catch { /* next lane */ }
      }
      // Last resort: hand back the Pollinations URL anyway — the browser will trigger generation.
      return done(pUrl, "Pollinations");
    } },
  { name: "list_photos", safe: true, description: "List the photos SAM has taken/saved (vault/photos) with timestamps — newest first. input: (none).", params: "(none)",
    activity: () => `Checking my photo roll`, run: async () => {
      const dir = join(VAULT_DIR, "photos");
      if (!existsSync(dir)) return "No photos yet — say 'take a photo' or hit 📸 in the ＋ menu.";
      const files = (await readdir(dir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort().reverse().slice(0, 40);
      return files.length ? `📸 ${files.length} photo(s), newest first:\n${files.map((f) => `- ${join(dir, f)}`).join("\n")}` : "No photos yet.";
    } },
  { name: "view_photo", safe: true, description: "Look at a saved photo/image file and describe or answer questions about it (e.g. find where objects are in past snapshots). input: {path, question?}.", params: "{path, question?}",
    activity: (i) => `Looking at ${basename(String(i.path || ""))}`, run: async (i) => {
      const p = String(i.path || i || "").replace(/^~/, homedir());
      // Safety: this auto-runs, so a prompt-injected model could try to read arbitrary files.
      // Only ever open real image files, and never anything inside a sensitive/hidden dir.
      if (!/\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(p)) return "I can only look at image files (jpg/png/gif/webp).";
      if (/\/\.(ssh|aws|gnupg|config|kube|docker)\b|\/\.env|id_rsa|\/etc\/|\/var\/(root|log)|Keychains?/i.test(p)) return "I won't open files from a protected location.";
      if (!existsSync(p)) return `Can't find that image: ${p || "(no path)"}`;
      const buf = await readFile(p);
      if (buf.length > 8 * 1024 * 1024) return "That image is over 8MB — too big to inspect.";
      const mime = /\.png$/i.test(p) ? "image/png" : /\.webp$/i.test(p) ? "image/webp" : /\.gif$/i.test(p) ? "image/gif" : "image/jpeg";
      const r = await runVision("You are SAM's eyes reviewing a saved photo.", String(i.question || "Describe this photo in detail — objects, people you might know, and where things are."), [{ mime, data: buf.toString("base64") }]);
      return r.text;
    } },
  { name: "transcribe_audio", safe: true, description: "Transcribe an audio file (voice memo, recording, podcast clip) to text — free via Groq Whisper. input: {path}.", params: "{path}",
    activity: (i) => `Transcribing ${basename(String(i.path || ""))}`, run: async (i) => {
      const p = String(i.path || i || "").replace(/^~/, homedir());
      if (!p || !existsSync(p)) return `Can't find that audio file: ${p || "(no path)"}`;
      const gk = getKey("groq");
      if (!gk) return "Transcription needs a (free) Groq key — grab one at console.groq.com/keys and paste it in Settings → API keys.";
      try {
        const buf = await readFile(p);
        if (buf.length > 24 * 1024 * 1024) return "That file's over 24MB — trim it down and I'll transcribe it.";
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(buf)]), basename(p) || "audio.m4a");
        form.append("model", "whisper-large-v3");
        const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST", headers: { Authorization: `Bearer ${gk}` }, body: form, signal: AbortSignal.timeout(120000),
        });
        if (!r.ok) { reportFailure("groq", gk, r.status); return `Transcription failed (HTTP ${r.status}).`; }
        reportSuccess("groq", gk);
        const text = ((await r.json()) as any)?.text?.trim() || "";
        return text ? `Transcript of ${basename(p)}:\n\n${clip(text, 6000)}` : "Transcribed, but it came back empty — is there speech in that file?";
      } catch (e: any) { return `Transcription hiccup: ${String(e?.message || e).slice(0, 120)}`; }
    } },
  { name: "generate_video", safe: true, description: "Create a short AI video (with sound) from a text description — HappyHorse #1 model via fal, or Novita/SiliconFlow free credits (~1-2 min). input: {prompt}.", params: "{prompt}",
    activity: (i) => `Filming: ${String(i.prompt || "").slice(0, 40)}…`, run: async (i) => {
      const prompt = String(i.prompt || i || "").trim();
      if (!prompt) return "Describe the video you want.";
      // Two free-credit lanes (Novita, SiliconFlow) — rotate to sip credits evenly. Both
      // are async APIs: submit a job, poll (bounded ~2 min).
      const poll = async (fn: () => Promise<string | "pending" | "failed">): Promise<string | null> => {
        for (let t = 0; t < 24; t++) {
          await new Promise((r) => setTimeout(r, 5000));
          try { const s = await fn(); if (s === "failed") return null; if (s !== "pending") return s; } catch { /* keep polling */ }
        }
        return null;
      };
      type VidLane = { id: string; make: (key: string) => Promise<string | null> };
      const LANES: VidLane[] = [
        { id: "fal", make: async (k) => {   // 🏇 HappyHorse 1.1 (Alibaba) — #1 arena video model, native audio; fal = official API
          const sub = await fetch("https://queue.fal.run/alibaba/happy-horse/v1.1/text-to-video", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Key ${k}` }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ prompt: prompt.slice(0, 500) }),
          });
          if (!sub.ok) { reportFailure("fal", k, sub.status); return null; }
          const j: any = await sub.json();
          const statusUrl = j?.status_url, responseUrl = j?.response_url;
          if (!statusUrl || !responseUrl) return null;
          const out = await poll(async () => {
            const st = await fetch(statusUrl, { headers: { Authorization: `Key ${k}` }, signal: AbortSignal.timeout(15000) });
            if (!st.ok) return "pending";
            const d: any = await st.json();
            if (d?.status === "COMPLETED") {
              const r = await fetch(responseUrl, { headers: { Authorization: `Key ${k}` }, signal: AbortSignal.timeout(15000) });
              const v: any = r.ok ? await r.json() : null;
              return v?.video?.url || v?.video_url || "failed";
            }
            if (d?.status === "FAILED" || d?.status === "ERROR") return "failed";
            return "pending";
          });
          if (out) reportSuccess("fal", k);
          return out;
        } },
        { id: "novita", make: async (k) => {
          const sub = await fetch("https://api.novita.ai/v3/async/txt2video", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ model_name: "darkSushiMixMix_225D_46414.safetensors", prompt: prompt.slice(0, 400), width: 640, height: 384, steps: 20, frames: 64 }),
          });
          if (!sub.ok) { reportFailure("novita", k, sub.status); return null; }
          const { task_id } = (await sub.json()) as { task_id?: string };
          if (!task_id) return null;
          const out = await poll(async () => {
            const st = await fetch(`https://api.novita.ai/v3/async/task-result?task_id=${encodeURIComponent(task_id)}`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000) });
            if (!st.ok) return "pending";
            const d: any = await st.json();
            if (d?.task?.status === "TASK_STATUS_SUCCEED") return d?.videos?.[0]?.video_url || d?.video?.video_url || "failed";
            if (d?.task?.status === "TASK_STATUS_FAILED") return "failed";
            return "pending";
          });
          if (out) reportSuccess("novita", k);
          return out;
        } },
        { id: "siliconflow", make: async (k) => {
          const sub = await fetch("https://api.siliconflow.cn/v1/video/submit", {
            method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(30000),
            body: JSON.stringify({ model: "Wan-AI/Wan2.1-T2V-14B-Turbo", prompt: prompt.slice(0, 400) }),
          });
          if (!sub.ok) { reportFailure("siliconflow", k, sub.status); return null; }
          const { requestId } = (await sub.json()) as { requestId?: string };
          if (!requestId) return null;
          const out = await poll(async () => {
            const st = await fetch("https://api.siliconflow.cn/v1/video/status", {
              method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(15000),
              body: JSON.stringify({ requestId }),
            });
            if (!st.ok) return "pending";
            const d: any = await st.json();
            if (d?.status === "Succeed") return d?.results?.videos?.[0]?.url || "failed";
            if (d?.status === "Failed") return "failed";
            return "pending";
          });
          if (out) reportSuccess("siliconflow", k);
          return out;
        } },
      ];
      const avail = LANES.filter((l) => poolSize(l.id) > 0);
      if (!avail.length) return "Video generation needs a free-credit key: fal.ai (🏇 HappyHorse — the #1 video model, with sound), Novita, or SiliconFlow — all give new accounts free credits; paste the key in Settings → API keys. Images, though, I can do free right now — want an image instead?";
      const start = Math.floor(Math.random() * avail.length);   // spread credit use
      for (let n = 0; n < avail.length; n++) {
        const lane = avail[(start + n) % avail.length];
        const k = getKey(lane.id); if (!k) continue;
        try { const u = await lane.make(k); if (u) return `🎬 Done — [watch / download your video](${u})\n\n(Made with your free ${lane.id} credits.)`; } catch { /* next lane */ }
      }
      return "Video didn't come back in time (or the free credits are spent) — check your provider dashboard, try a simpler prompt, or want a free image instead?";
    } },
  { name: "capacity_status", safe: true, description: "How much FREE AI capacity SAM has right now, and the one legit free key to add if it's running thin. input: (none).", params: "(none)",
    activity: () => `Checking free AI capacity`, run: async () => {
      const r = capacityReport();
      const nudge = capacityNudge();
      return `Free AI capacity: ${r.level.toUpperCase()} — ${r.configured} free provider(s) configured, ${r.healthy}/${r.freeKeys} keys ready` +
        (r.cooling ? `, ${r.cooling} cooling (rate-limited)` : "") + ".\n" + (nudge || "You're well-stocked — nothing to add.") +
        `\n(Local Ollama is always the unlimited, key-free fallback.)`;
    } },
  { name: "key_pool_status", safe: true, description: "Live dashboard showing every AI provider's key pool: how many keys are healthy vs cooling down.", params: "(none)",
    activity: () => `Checking key pool health`, run: async () => {
      const pools = keyStatus();
      const active = pools.filter((p) => p.total > 0);
      if (!active.length) return "No API keys configured. Add *_API_KEYS to .env and restart SAM.";
      const lines = active.map((p) => {
        const status = p.healthy === 0 ? "🔴 all cooling" : p.cooling > 0 ? `🟡 ${p.healthy} healthy, ${p.cooling} cooling` : `🟢 ${p.healthy} healthy`;
        return `  ${p.provider.padEnd(14)} ${status}  (${p.uses} total uses)`;
      });
      return `Provider key pool status:\n${lines.join("\n")}`;
    } },
  // ─── ADMIN: SELFTEST ──────────────────────────────────────────────────────
  { name: "run_selftest", safe: true, description: "Run SAM's full production health check: models, vault, tools, agents. Returns green/red per subsystem.", params: "(none)",
    activity: () => `Running production selftest`, run: async () => {
      const r = await runSelftest();
      const lines = [`SAM Selftest — ${r.ok ? "✅ ALL GREEN" : "❌ ISSUES FOUND"} (${r.timestamp})`];
      const s = r.subsystems;
      lines.push(`  Models  ${s.models.ok ? "✅" : "⚠️ "}  ${s.models.info}`);
      lines.push(`  Vault   ${s.vault.ok ? "✅" : "❌"}  ${s.vault.info}`);
      lines.push(`  Tools   ${s.tools.ok ? "✅" : "❌"}  ${s.tools.count} registered${s.tools.duplicates ? `, ${s.tools.duplicates} duplicates!` : ""}`);
      lines.push(`  Agents  ${s.agents.ok ? "✅" : "❌"}  ${s.agents.count} registered${s.agents.duplicates ? `, ${s.agents.duplicates} duplicates!` : ""}`);
      return lines.join("\n");
    } },
  // ─── ADMIN: SKILLS ────────────────────────────────────────────────────────
  { name: "list_skills", safe: true, description: "List all SAM skill packs loaded from /skills — their names, tiers, and trigger keywords.", params: "(none)",
    activity: () => `Listing skill packs`, run: async () => {
      const skills = loadSkills();
      if (!skills.length) return "No skill packs found in /skills directory.";
      return skills.map((s) => `  [${s.tier}] ${s.name} — triggers: ${s.triggers.join(", ") || "(none)"}`).join("\n");
    } },
  // ─── ADMIN: PROJECTS ──────────────────────────────────────────────────────
  { name: "add_project", safe: false, description: "Add a new brand/project to the Project Registry (writes to vault/brands.json). input: {id, name, status, summary, domain?}.", params: "{id, name, status, summary, domain?}",
    activity: (i) => `Adding project: ${i.name}`, preview: (i) => `Add project '${i.name}' to vault/brands.json?`,
    run: async (i) => {
      try {
        const fs = await import("node:fs/promises");
        const brandsPath = resolve(process.cwd(), "vault", "brands.json");
        let brands: any[] = [];
        try { brands = JSON.parse(await fs.readFile(brandsPath, "utf8")); } catch { brands = [...PROJECTS]; }
        if (brands.find((p: any) => p.id === i.id)) return `Project '${i.id}' already exists. Use update_project to change it.`;
        brands.push({ id: i.id, name: i.name, domain: i.domain, status: i.status || "concept", branch: "ops", summary: i.summary });
        await fs.mkdir(resolve(process.cwd(), "vault"), { recursive: true });
        await fs.writeFile(brandsPath, JSON.stringify(brands, null, 2), "utf8");
        return `Added project '${i.name}'. Restart SAM for it to appear in the project context.`;
      } catch (e: any) { return `Failed: ${e.message}`; }
    } },
  { name: "update_project", safe: false, description: "Update an existing project's status or summary in vault/brands.json. input: {id, status?, summary?, domain?}.", params: "{id, status?, summary?, domain?}",
    activity: (i) => `Updating project: ${i.id}`, preview: (i) => `Update project '${i.id}'?`,
    run: async (i) => {
      try {
        const fs = await import("node:fs/promises");
        const brandsPath = resolve(process.cwd(), "vault", "brands.json");
        let brands: any[] = [];
        try { brands = JSON.parse(await fs.readFile(brandsPath, "utf8")); } catch { brands = [...PROJECTS]; }
        const idx = brands.findIndex((p: any) => p.id === i.id);
        if (idx < 0) return `Project '${i.id}' not found. Use list_projects to see IDs.`;
        if (i.status) brands[idx].status = i.status;
        if (i.summary) brands[idx].summary = i.summary;
        if (i.domain) brands[idx].domain = i.domain;
        await fs.mkdir(resolve(process.cwd(), "vault"), { recursive: true });
        await fs.writeFile(brandsPath, JSON.stringify(brands, null, 2), "utf8");
        return `Updated project '${i.id}'.`;
      } catch (e: any) { return `Failed: ${e.message}`; }
    } },
  { name: "import_context", safe: false, description: "Extract and import user persona/facts from a pasted ChatGPT/Claude/Gemini chat history or text profile. input: {text}.", params: "{text}",
    activity: () => `Importing user context`, preview: () => `Extract and save facts from imported context?`,
    run: async (i) => {
      try {
        const name = process.env.SAM_USER_NAME || "the user";
        const facts = await extractFactsFromTranscript(name, i.text, "free");
        const count = await saveImportedFacts(facts);
        return `Successfully processed context. Extracted ${facts.length} facts, saved ${count} new facts to memory.`;
      } catch (e: any) { return `Failed to import context: ${e.message}`; }
    } },
  // ── THE FORGE (Phase 5) — SAM writes its own tools. Confirm-tier: it asks before drafting.
  // The drafted tool is saved DISABLED for the user to review + enable; it can never self-approve.
  { name: "forge", safe: false, description: "When no existing tool fits, DRAFT a new tool for a need. Pure-computation by default; may declare capabilities (net, fs:read, fs:write) — net/fs:write become dangerous-tier. SAM writes it, safety-scans it, sandbox-tests it, then saves it DISABLED for you to review + enable in Settings. input: {need}.", params: "{need}",
    activity: (i) => `Forging a tool for: ${i.need ?? i}`,
    preview: (i) => `Draft, safety-scan and sandbox-test a brand-new tool for "${i.need ?? i}". It's saved DISABLED — you review the code + declared capabilities and enable it in Settings before it can ever run.`,
    run: async (i) => {
      const r = await forgeTool(String(i.need ?? i ?? ""));
      if (!r.ok) return `Couldn't forge that: ${r.reason}`;
      const t = r.tool!;
      const caps = t.caps.length ? `Capabilities: ${t.caps.join(", ")} → ${t.tier} tier` : `Pure computation → confirm tier`;
      const samples = (r.samples || []).slice(0, 2).map((s) => `  ${JSON.stringify(s.input)} → ${s.output.slice(0, 80)}`).join("\n");
      return `Forged "${t.name}" (saved disabled — review + enable it in Settings):\n${t.explanation}\n${caps}\n\nCode:\n${t.code}\n\nSandbox test:\n${samples}`;
    } },
  { name: "forged_tools", safe: true, description: "List the tools SAM has forged for itself — enabled/disabled status + capabilities. input: (none).", params: "(none)",
    activity: () => `Checking SAM-forged tools`, run: async () => {
      const all = listForged(); const s = forgedStats();
      if (!all.length) return "SAM hasn't forged any tools yet. Ask for something no built-in tool covers and SAM can build it.";
      return `${s.enabled}/${s.total} forged tools enabled (${s.dangerous} dangerous):\n` + all.map((t) => `- ${t.name} [${t.enabled ? "on" : "off"}] ${t.caps.length ? `{${t.caps.join(",")}}` : ""} — ${t.explanation}`).join("\n");
    } },
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

// Tool catalogue injected into the model's system prompt.
// Pass a subset of names to expose only the relevant tools (smarter + cheaper).
export function toolCatalogue(names?: string[]): string {
  const list = names ? TOOLS.filter((t) => names.includes(t.name)) : TOOLS;
  return list.map((t) => `- ${t.name}(${t.params})${t.safe ? "" : " [asks first]"}: ${t.description}`).join("\n");
}
