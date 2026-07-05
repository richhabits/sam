// ─────────────────────────────────────────────────────────────
//  S.A.M. · TOOLS  (THE HANDS)
//  Every real-world action SAM can take. Each tool declares
//  whether it's `safe` (runs automatically) or risky (needs
//  the user's OK first — the ask-first safety gate).
//
//  100% local / free: uses macOS built-ins (osascript, System
//  Events, screencapture, open) + Node + fetch. No paid APIs.
// ─────────────────────────────────────────────────────────────

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { homedir, cpus, totalmem, freemem, uptime } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { resolve, dirname, basename, extname, join } from "node:path";
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
import { addSchedule, listSchedules, removeSchedule, toggleSchedule } from "./scheduler.ts";
import { startSwarm, loadSwarms, stopSwarm } from "./swarm.ts";
import { listAllowed, allow, disallow, setAutopilot, autopilotOn, isElonMode } from "./authz.ts";
import { PROJECTS } from "./projects.ts";
import { keyStatus } from "./keys.ts";
import { runSelftest } from "./selftest.ts";
import { loadSkills } from "./skills.ts";
import { vaultStats, recentLog, pruneOldLogs } from "./vault.ts";
import { extractFactsFromTranscript, saveImportedFacts } from "./importer.ts";

const sh = promisify(exec);

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

// git in a specific local repo folder (handles spaces in paths like "ROMEO HQ").
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
function needsMac(feature: string): string {
  return `“${feature}” uses macOS-only automation, and SAM is running on ${OS}. It works on a Mac. (Web, files, terminal, and weather work on any laptop.)`;
}
// Cross-platform "open this URL/app/file with the system default".
function openCmd(target: string): string {
  if (OS === "mac") return `open ${JSON.stringify(target)}`;
  if (OS === "windows") return `start "" ${JSON.stringify(target)}`;
  return `xdg-open ${JSON.stringify(target)}`;
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

// Never run these, even if approved — catastrophic / irreversible.
const HARD_DENY = [
  /\brm\s+-rf\s+[~/]\s*($|\S)/, /\bmkfs\b/, /\bdd\s+if=/, /:\(\)\s*\{/,
  /\bshutdown\b/, /\breboot\b/, /\bkillall\s+-9\b/, />\s*\/dev\/sd/,
  /\bchmod\s+-R\s+000\b/, /\bsudo\s+rm\b/,
];
function denied(cmd: string): string | null {
  for (const re of HARD_DENY) if (re.test(cmd)) {
    logSecurity("alert", "blocked-command", `Refused a catastrophic command: ${cmd}`, "agent");
    return `Blocked for safety: "${cmd}" matches a catastrophic-command guard. SAM will never run this.`;
  }
  return null;
}

const clip = (s: string, n = 6000) => (s.length > n ? s.slice(0, n) + `\n…[trimmed, ${s.length} chars total]` : s);
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// ── INTERNET ─────────────────────────────────────────────────
// Prefers Jina (clean, reliable) when a key is set; falls back to a
// free DuckDuckGo scrape so the web always works.
async function webSearch(q: string): Promise<string> {
  if (hasJina()) {
    try { return clip(await jinaSearch(q), 1800); } catch { /* fall back */ }   // tight — keeps the whole loop under free-tier token limits
  }
  const r = await fetch("https://duckduckgo.com/html/?q=" + encodeURIComponent(q), {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" },
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
  if (hasJina()) {
    try { return clip(await jinaRead(url), 5000); } catch { /* fall back */ }
  }
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" } });
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

// ── macOS CONTROL · mouse / keyboard / apps / screen ─────────
async function osa(script: string): Promise<string> {
  if (!IS_MAC) throw new Error("maconly");
  const { stdout } = await sh(`osascript -e "${esc(script)}"`, { timeout: 30000 });
  return stdout.trim();
}
async function openApp(name: string): Promise<string> {
  if (IS_MAC) await sh(`open -a ${JSON.stringify(name)}`);
  else if (OS === "windows") await sh(`start "" ${JSON.stringify(name)}`);
  else await sh(`${JSON.stringify(name)} &`).catch(() => {});
  return `Opened ${name}.`;
}
async function typeText(text: string): Promise<string> {
  await osa(`tell application "System Events" to keystroke "${esc(text)}"`);
  return `Typed: ${text}`;
}
async function pressKey(input: { key: string; modifiers?: string[] }): Promise<string> {
  const mods = (input.modifiers || []).map((m) => `${m} down`).join(", ");
  const using = mods ? ` using {${mods}}` : "";
  await osa(`tell application "System Events" to key code ${input.key}${using}`);
  return `Pressed key ${input.key}${using}`;
}
async function clickAt(input: { x: number; y: number }): Promise<string> {
  // Uses System Events click at coordinates (no external deps).
  await osa(`tell application "System Events" to click at {${input.x}, ${input.y}}`);
  return `Clicked at ${input.x},${input.y}`;
}
async function appleScript(script: string): Promise<string> {
  try { return (await osa(script)) || "(AppleScript ran, no output)"; }
  catch (e: any) { return `AppleScript failed: ${e?.message}`; }
}
async function screenshot(): Promise<string> {
  if (!IS_MAC) return needsMac("screenshot");
  const path = resolve(homedir(), "Desktop", `SAM-screenshot-${Date.now()}.png`);
  await sh(`screencapture -x ${JSON.stringify(path)}`);
  return `Saved a screenshot to ${path}`;
}
async function clipboardGet(): Promise<string> {
  try {
    if (IS_MAC) { const { stdout } = await sh("pbpaste"); return clip(stdout, 4000); }
    if (OS === "windows") { const { stdout } = await sh("powershell -command Get-Clipboard"); return clip(stdout, 4000); }
    const { stdout } = await sh("xclip -selection clipboard -o"); return clip(stdout, 4000);
  } catch { return needsMac("read clipboard"); }
}
async function clipboardSet(text: string): Promise<string> {
  try {
    if (IS_MAC) await sh(`printf %s ${JSON.stringify(text)} | pbcopy`);
    else if (OS === "windows") await sh(`echo ${JSON.stringify(text)} | clip`);
    else await sh(`printf %s ${JSON.stringify(text)} | xclip -selection clipboard`);
    return "Copied to clipboard.";
  } catch { return needsMac("set clipboard"); }
}
async function notify(input: { title?: string; message: string }): Promise<string> {
  await osa(`display notification "${esc(input.message)}" with title "${esc(input.title || "SAM")}"`);
  return "Notification shown.";
}

// ── MORE INTERNET / INFO (safe) ──────────────────────────────
async function getWeather(place: string): Promise<string> {
  const r = await fetch("https://wttr.in/" + encodeURIComponent(place || "") + "?format=%l:+%C+%t,+feels+%f,+wind+%w,+humidity+%h");
  return (await r.text()).trim() || "Couldn't get the weather.";
}
async function openUrl(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  await sh(openCmd(url)); return `Opened ${url} in your browser.`;
}
async function searchFiles(q: string): Promise<string> {
  try {
    if (IS_MAC) { const { stdout } = await sh(`mdfind ${JSON.stringify(q)} | head -30`, { timeout: 20000 }); return clip(stdout.trim()) || "No files found."; }
    const { stdout } = await sh(`grep -rl ${JSON.stringify(q)} ${JSON.stringify(homedir())} 2>/dev/null | head -30`, { timeout: 20000 });
    return clip(stdout.trim()) || "No files found.";
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
    const { stdout } = await sh("acpi -b 2>/dev/null || cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || echo 'battery info unavailable'");
    return stdout.trim();
  } catch { return "Battery info unavailable on this system."; }
}
async function speak(text: string): Promise<string> {
  if (!IS_MAC) return "SAM can speak in the browser instead (turn on 'Read replies aloud' in settings).";
  await sh(`say ${JSON.stringify(text)}`); return `Said: ${text}`;
}

// ── MORE macOS ACTIONS (risky) ───────────────────────────────
async function sendEmail(i: { to: string; subject?: string; body: string }): Promise<string> {
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
async function addReminder(i: { text: string; list?: string }): Promise<string> {
  const list = i.list ? `list "${esc(i.list)}"` : "default list";
  await osa(`tell application "Reminders" to make new reminder at ${list} with properties {name:"${esc(i.text)}"}`);
  return `Added reminder: ${i.text}`;
}
async function addCalendarEvent(i: { title: string; start?: string; calendar?: string }): Promise<string> {
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
  if (!IS_MAC) return needsMac("phone calls");
  const n = String(number).replace(/[^\d+*#]/g, "");
  await sh(`open ${JSON.stringify("tel://" + n)}`);
  return `Calling ${number} — pick up on your Mac or iPhone. (Needs 'Calls from iPhone' on in FaceTime settings.)`;
}
async function faceTime(who: string): Promise<string> {
  if (!IS_MAC) return needsMac("FaceTime");
  await sh(`open ${JSON.stringify("facetime://" + who)}`);
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
      activeBrowser = await chromium.launch({ executablePath, headless: false });
      const ctx = await activeBrowser.newContext();
      activePage = await ctx.newPage();
    } catch (e: any) {
      throw new Error(`Could not launch Chrome. Ensure it's installed. Error: ${e.message}`);
    }
  }
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
  { name: "read_file", safe: true, description: "Read a file's contents. input: a file path (supports ~).", params: "path",
    activity: (i) => `Reading file ${i.path ?? i}`, run: (i) => readFileTool(i.path ?? i) },
  { name: "list_dir", safe: true, description: "List a folder's contents. input: a folder path (supports ~).", params: "path",
    activity: (i) => `Looking in ${i.path ?? i ?? "~"}`, run: (i) => listDir(i.path ?? i ?? "~") },
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
      if (isNaN(min) || min <= 0) return "Invalid minutes.";
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
      try { await sh(`diskutil eject "/Volumes/${i.volume_name.replace(/"/g, "")}"`); return `Ejected ${i.volume_name}.`; } catch (e: any) { return `Failed to eject: ${e.message}`; }
    } },
  { name: "caffeinate", safe: true, description: "Prevent the Mac from sleeping for a duration. input: {minutes}.", params: "{minutes}",
    activity: (i) => `Keeping Mac awake for ${i.minutes}m`,
    run: async (i) => {
      if (!IS_MAC) return "Caffeinate only works on macOS.";
      const min = Number(i.minutes);
      if (isNaN(min) || min <= 0) return "Invalid minutes.";
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
        await osa(`tell application "${i.app_name}" to activate`);
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
        const res = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(i.url)}`);
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
        const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
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
        const res = await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`);
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
        const res = await fetch(`http://ip-api.com/json/${i.ip}`);
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
      if (isNaN(v)) return "Invalid amount.";
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
        const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${text}`);
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
        const res = await fetch(`https://wttr.in/${encodeURIComponent(i.location || "")}?format=j1`);
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
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(i.ticker)}`);
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
        const res = await fetch("https://news.google.com/rss");
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
        for (const [hash, paths] of map.entries()) {
          if (paths.length > 1) {
            out += `Duplicate Group:\\n` + paths.map(p => `  - ${p}`).join("\\n") + "\\n\\n";
          }
        }
        return out.trim() || "No duplicates found.";
      } catch (e: any) { return `Failed to dedupe files: ${e.message}`; }
    } },
  { name: "add_calendar_event", safe: false, description: "Create a scheduled event in the native macOS Calendar app. input: {title, start_date, end_date} (Dates must be parseable by AppleScript like '12/25/2026 14:00').", params: "{title, start_date, end_date}",
    activity: (i) => `Scheduling ${i.title} on Calendar`, preview: (i) => `Add to Calendar:\n${i.title}\nFrom: ${i.start_date}\nTo: ${i.end_date}`,
    run: async (i) => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        await osa(`tell application "Calendar" to tell calendar "Home" to make new event at end of events with properties {summary:"${i.title.replace(/"/g, "")}", start date:date "${i.start_date}", end date:date "${i.end_date}"}`);
        return "Event created successfully in Calendar.";
      } catch (e: any) {
        try {
          await osa(`tell application "Calendar" to tell calendar 1 to make new event at end of events with properties {summary:"${i.title.replace(/"/g, "")}", start date:date "${i.start_date}", end date:date "${i.end_date}"}`);
          return "Event created successfully in default Calendar.";
        } catch (err: any) { return `Failed to create event: ${err.message}`; }
      }
    } },

  { name: "create_apple_note", safe: true, description: "Create a new note in the native Apple Notes app. input: {title, body}.", params: "{title, body}",
    activity: (i) => `Creating Apple Note: ${i.title}`,
    run: async (i) => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        const content = `<h1>${i.title}</h1><p>${i.body.replace(/\\n/g, "<br>")}</p>`;
        await osa(`tell application "Notes" to make new note with properties {body:"${content.replace(/"/g, "\\\"")}"}`);
        return "Note created successfully in Apple Notes.";
      } catch (e: any) { return `Failed to create note: ${e.message}`; }
    } },
  { name: "search_apple_notes", safe: true, description: "Search Apple Notes and return content of matches. input: {query}.", params: "{query}",
    activity: (i) => `Searching Apple Notes for "${i.query}"`,
    run: async (i) => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        const script = `
tell application "Notes"
	set matchNotes to notes whose name contains "${i.query.replace(/"/g, "")}" or body contains "${i.query.replace(/"/g, "")}"
	set out to ""
	repeat with n in matchNotes
		set out to out & "Title: " & name of n & "\n" & body of n & "\n\n"
	end repeat
	return out
end tell`;
        const result = await osa(script);
        return result.trim() || "No matching notes found.";
      } catch (e: any) { return `Failed to search notes: ${e.message}`; }
    } },
  { name: "send_email", safe: false, description: "Draft and send an email natively through the macOS Apple Mail app. input: {to_email, subject, body}.", params: "{to_email, subject, body}",
    activity: (i) => `Sending email to ${i.to_email}`, preview: (i) => `Send email to ${i.to_email}:\nSubject: ${i.subject}\n${i.body}`,
    run: async (i) => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        const script = `tell application "Mail"
	set theMessage to make new outgoing message with properties {subject:"${i.subject.replace(/"/g, "\\\"")}", content:"${i.body.replace(/"/g, "\\\"")}", visible:false}
	tell theMessage
		make new to recipient at end of to recipients with properties {address:"${i.to_email.replace(/"/g, "\\\"")}"}
		send
	end tell
end tell`;
        await osa(script);
        return `Email sent successfully to ${i.to_email}.`;
      } catch (e: any) { return `Failed to send email: ${e.message}`; }
    } },
  { name: "open_apple_maps", safe: true, description: "Instantly launch Apple Maps with a specific address or search query. input: {address_or_query}.", params: "{address_or_query}",
    activity: (i) => `Opening Apple Maps for ${i.address_or_query}`,
    run: (i) => openUrl(`maps://?q=${encodeURIComponent(i.address_or_query)}`).then(() => `Apple Maps opened for: ${i.address_or_query}`) },
  { name: "add_apple_contact", safe: false, description: "Programmatically add a new person to your native macOS Contacts. input: {first_name, last_name?, phone?, email?}.", params: "{first_name, last_name?, phone?, email?}",
    activity: (i) => `Adding contact: ${i.first_name}`, preview: (i) => `Add to Contacts:\nName: ${i.first_name} ${i.last_name || ""}\nPhone: ${i.phone || ""}\nEmail: ${i.email || ""}`,
    run: async (i) => {
      if (!IS_MAC) return "Requires macOS.";
      try {
        const lastStr = i.last_name ? `last name:"${i.last_name.replace(/"/g, "\\\"")}", ` : "";
        let script = `tell application "Contacts"\nset newPerson to make new person with properties {first name:"${i.first_name.replace(/"/g, "\\\"")}", ${lastStr}}\n`;
        if (i.phone) script += `make new phone at end of phones of newPerson with properties {label:"Mobile", value:"${i.phone.replace(/"/g, "\\\"")}"}\n`;
        if (i.email) script += `make new email at end of emails of newPerson with properties {label:"Work", value:"${i.email.replace(/"/g, "\\\"")}"}\n`;
        script += `save\nend tell`;
        await osa(script);
        return "Contact added successfully.";
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
    activity: (i) => `Sending a notification`, run: (i) => notify(i) },
  { name: "get_weather", safe: true, description: "Get current weather. input: a place name (city).", params: "place",
    activity: (i) => `Checking the weather in ${i.place ?? i ?? "your area"}`, run: (i) => getWeather(i.place ?? i ?? "") },

  // ── FREE UTILITY BATCH — no API keys, local OS or free web ──
  { name: "qr_code", safe: true, description: "Make a QR code for text/a link and open it. input: text.", params: "text",
    activity: () => `Making a QR code`,
    run: (i) => openUrl(`https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(String(i.text ?? i))}`).then(() => `📱 QR code opened for: ${i.text ?? i}`) },
  { name: "battery_status", safe: true, description: "Check the Mac's battery level and charging state.", params: "(none)",
    activity: () => `Checking battery`,
    run: async () => { if (!IS_MAC) return needsMac("Battery"); const { stdout } = await sh(`pmset -g batt | grep -Eo '[0-9]+%[^;]*' | head -1`); return `🔋 ${stdout.trim() || "unknown"}`; } },
  { name: "disk_space", safe: true, description: "How much disk space is free.", params: "(none)",
    activity: () => `Checking disk space`,
    run: async () => { const { stdout } = await sh(`df -h / | tail -1 | awk '{print $4" free of "$2" ("$5" used)"}'`); return `💾 ${stdout.trim()}`; } },
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
    run: async (i) => { const p = safePath("./vault/notes/quick.md"); await sh(`mkdir -p ${shq(dirname(p))}`); await writeFile(p, `[${nowText()}] ${String(i.text ?? i)}\n`, { flag: "a" }); return `📝 Noted to your vault.`; } },
  { name: "crypto_price", safe: true, description: "Get a crypto price. input: coin (bitcoin, ethereum…).", params: "coin",
    activity: (i) => `Checking ${i.coin ?? i} price`,
    run: async (i) => { try { const coin = String(i.coin ?? i).toLowerCase(); const d: any = await (await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=usd,gbp`)).json(); const p = d?.[coin]; return p ? `🪙 ${coin}: $${p.usd} · £${p.gbp}` : `Couldn't find "${coin}".`; } catch (e: any) { return `Crypto lookup failed: ${e?.message}`; } } },
  { name: "define_word", safe: true, description: "Define a word. input: word.", params: "word",
    activity: (i) => `Defining "${i.word ?? i}"`,
    run: async (i) => { try { const w = String(i.word ?? i); const d: any = await (await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`)).json(); const defs = d?.[0]?.meanings?.slice(0, 2).map((m: any) => `(${m.partOfSpeech}) ${m.definitions?.[0]?.definition}`).join("\n"); return defs ? `📖 ${w}\n${defs}` : `No definition for "${w}".`; } catch (e: any) { return `Lookup failed: ${e?.message}`; } } },
  { name: "wikipedia", safe: true, description: "Get a Wikipedia summary. input: topic.", params: "topic",
    activity: (i) => `Reading Wikipedia: ${i.topic ?? i}`,
    run: async (i) => { try { const t = String(i.topic ?? i); const d: any = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`)).json(); return d?.extract ? `📚 ${d.title}\n${d.extract}` : `No Wikipedia page for "${t}".`; } catch (e: any) { return `Lookup failed: ${e?.message}`; } } },
  { name: "hacker_news", safe: true, description: "Top Hacker News stories right now.", params: "(none)",
    activity: () => `Fetching Hacker News`,
    run: async () => { try { const ids: any = await (await fetch("https://hacker-news.firebaseio.com/v0/topstories.json")).json(); const top = await Promise.all(ids.slice(0, 8).map(async (id: number) => { const s: any = await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json(); return `• ${s.title} (${s.score}▲) ${s.url || ""}`; })); return `📰 Top HN:\n${top.join("\n")}`; } catch (e: any) { return `HN fetch failed: ${e?.message}`; } } },
  { name: "dns_lookup", safe: true, description: "DNS lookup for a domain. input: domain.", params: "domain",
    activity: (i) => `DNS lookup: ${i.domain ?? i}`,
    run: async (i) => { const { stdout } = await sh(`dig +short ${shq(String(i.domain ?? i))} 2>/dev/null || nslookup ${shq(String(i.domain ?? i))} 2>/dev/null | tail -n +4`); return stdout.trim() || "No records found."; } },
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
    run: (i) => sh(`cd ${shq(i.dir)} && npm run ${shq(i.script)} 2>&1 | tail -40`, { timeout: 180000 }).then((r: any) => (r.stdout || "(done)").toString().slice(0, 4000)).catch((e: any) => `failed: ${(e?.stderr || e?.message || e).toString().slice(0, 400)}`) },
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
    activity: (i) => `Ticking off a nudge`,
    run: async (i) => completeNudge(i.text ?? i.id ?? i) },

  // ── File utilities (quick wins) ──
  { name: "move_file", safe: false, description: "Move or rename a file/folder. input: {from, to}.", params: "{from, to}",
    activity: (i) => `Moving ${i.from} → ${i.to}`,
    preview: (i) => `Move / rename:\n${i.from}\n→ ${i.to}`,
    run: (i) => sh(`mv ${shq(safePath(i.from))} ${shq(safePath(i.to))}`).then(() => `Moved to ${i.to}`).catch((e: any) => `Couldn't move: ${e?.message}`) },
  { name: "make_folder", safe: false, description: "Create a folder (and any parent folders). input: path.", params: "path",
    activity: (i) => `Creating folder ${i.path ?? i}`,
    preview: (i) => `Create folder: ${i.path ?? i}`,
    run: (i) => sh(`mkdir -p ${shq(safePath(i.path ?? i))}`).then(() => `Created ${i.path ?? i}`).catch((e: any) => `Couldn't: ${e?.message}`) },
  { name: "compress", safe: false, description: "Zip a file or folder. input: {path, out?}.", params: "{path, out?}",
    activity: (i) => `Zipping ${i.path}`,
    preview: (i) => `Zip: ${i.path}`,
    run: (i) => { const src = safePath(i.path); const out = safePath(i.out || i.path + ".zip"); return sh(`cd ${shq(dirname(src))} && zip -rq ${shq(out)} ${shq(basename(src))}`).then(() => `Zipped to ${out}`).catch((e: any) => `Couldn't zip: ${e?.message}`); } },
  { name: "unzip_file", safe: false, description: "Unzip an archive. input: {path, to?}.", params: "{path, to?}",
    activity: (i) => `Unzipping ${i.path}`,
    preview: (i) => `Unzip: ${i.path}`,
    run: (i) => sh(`unzip -oq ${shq(safePath(i.path))} ${i.to ? `-d ${shq(safePath(i.to))}` : `-d ${shq(dirname(safePath(i.path)))}`}`).then(() => `Unzipped ${i.path}`).catch((e: any) => `Couldn't unzip: ${e?.message}`) },
  { name: "directions", safe: true, description: "Open directions / a map lookup. input: {to, from?}.", params: "{to, from?}",
    activity: (i) => `Getting directions to ${i.to ?? i}`,
    run: (i) => { const to = encodeURIComponent(i.to ?? i); const from = i.from ? `&origin=${encodeURIComponent(i.from)}` : ""; return openUrl(`https://www.google.com/maps/dir/?api=1&destination=${to}${from}`).then(() => `Opened directions to ${i.to ?? i}`); } },
  { name: "backup_vault", safe: true, description: "Back up SAM's memory vault to a timestamped folder on the Desktop.", params: "(none)",
    activity: () => `Backing up your SAM memory`,
    run: async () => { const stamp = nowText().replace(/[^0-9]/g, "").slice(0, 12); const dest = safePath(`~/Desktop/sam-vault-backup-${stamp}`); try { await sh(`cp -R ${shq(safePath("./vault"))} ${shq(dest)}`); return `Backed up your vault to ${dest}`; } catch (e: any) { return `Backup failed: ${e?.message}`; } } },
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
  { name: "get_battery", safe: true, description: "Get battery status.", params: "(none)",
    activity: () => `Checking the battery`, run: getBattery },
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
    activity: (i) => `Running a command`, preview: (i) => `Terminal command:\n  ${i.command ?? i}`, run: (i) => runCommand(i.command ?? i) },
  { name: "write_file", safe: false, description: "Write/overwrite a file. input: {path, content}.", params: "{path, content}",
    activity: (i) => `Saving ${i.path}`, preview: (i) => `Write to ${i.path} (${(i.content||"").length} chars)`, run: (i) => writeFileTool(i) },
  { name: "open_app", safe: false, description: "Open a Mac application. input: app name.", params: "app name",
    activity: (i) => `Opening ${i.app ?? i}`, preview: (i) => `Open app: ${i.app ?? i}`, run: (i) => openApp(i.app ?? i) },
  { name: "type_text", safe: false, description: "Type text via the keyboard into the focused app. input: text.", params: "text",
    activity: () => `Typing`, preview: (i) => `Type into the active app:\n  ${i.text ?? i}`, run: (i) => typeText(i.text ?? i) },
  { name: "press_key", safe: false, description: "Press a key. input: {key: <key code number>, modifiers?: [command|shift|option|control]}.", params: "{key, modifiers?}",
    activity: () => `Pressing a key`, preview: (i) => `Press key code ${i.key}${i.modifiers?` + ${i.modifiers.join("+")}`:""}`, run: (i) => pressKey(i) },
  { name: "click", safe: false, description: "Click the mouse at screen coordinates. input: {x, y}.", params: "{x, y}",
    activity: (i) => `Clicking the screen`, preview: (i) => `Click at ${i.x}, ${i.y}`, run: (i) => clickAt(i) },
  { name: "applescript", safe: false, description: "Run AppleScript for deep macOS automation (control apps, Messages, Mail, etc). input: script.", params: "script",
    activity: () => `Automating an app`, preview: (i) => `Run AppleScript:\n${i.script ?? i}`, run: (i) => appleScript(i.script ?? i) },
  { name: "clipboard_set", safe: false, description: "Put text on the clipboard. input: text.", params: "text",
    activity: () => `Copying to clipboard`, preview: (i) => `Copy to clipboard:\n  ${i.text ?? i}`, run: (i) => clipboardSet(i.text ?? i) },
  { name: "send_imessage", safe: false, description: "Send an iMessage/text. input: {to, message}.", params: "{to, message}",
    activity: (i) => `Texting ${i.to}`, preview: (i) => `Send iMessage\n  To: ${i.to}\n  ${i.message}`, run: (i) => sendIMessage(i) },
  { name: "read_apple_notes", safe: true, description: "Read the user's recently modified Apple Notes. Mac only.", params: "(none)",
    activity: () => `Reading Apple Notes`, run: async () => { if (!IS_MAC) return "Apple Notes only works on macOS."; return await readAppleNotes(); } },
  { name: "append_apple_note", safe: false, description: "Append text to an Apple Note by title. Mac only. input: {title, text}.", params: "{title, text}",
    activity: (i) => `Appending to note: ${i.title}`, preview: (i) => `Append to Note '${i.title}':\n${clip(i.text, 100)}`,
    run: async (i) => {
      if (!IS_MAC) return "Apple Notes only works on macOS.";
      try {
        await osa(`tell application "Notes"
  set n to first note whose name contains "${esc(i.title)}"
  set body HTML of n to (body HTML of n) & "<br><br>${esc(i.text).replace(/\n/g, "<br>")}"
end tell`);
        return `Appended to note '${i.title}'.`;
      } catch (e: any) { return `Couldn't append to Note: ${e.message}`; }
    } },
  { name: "read_reminders", safe: true, description: "Read the user's pending Apple Reminders. Mac only.", params: "(none)",
    activity: () => `Checking Apple Reminders`, run: async () => { if (!IS_MAC) return "Apple Reminders only works on macOS."; return await readReminders(); } },
  { name: "browser_navigate", safe: false, description: "Open a Chrome browser tab and navigate to a URL. Returns page title.", params: "url",
    activity: (i) => `Navigating to ${i.url ?? i}`, preview: (i) => `Browser: Go to ${i.url ?? i}`, run: (i) => browserNavigate(i.url ?? i) },
  { name: "browser_read", safe: true, description: "Read the visible text from the currently open Chrome tab.", params: "(none)",
    activity: () => `Reading active browser tab`, run: browserRead },
  { name: "browser_click", safe: false, description: "Click an element in the active Chrome tab using a CSS selector.", params: "selector",
    activity: (i) => `Clicking ${i.selector ?? i}`, preview: (i) => `Browser: Click '${i.selector ?? i}'`, run: (i) => browserClick(i.selector ?? i) },
  { name: "browser_type", safe: false, description: "Type text into an element in the active Chrome tab. input: {selector, text, submit?}.", params: "{selector, text, submit?}",
    activity: (i) => `Typing into ${i.selector}`, preview: (i) => `Browser: Type into '${i.selector}'\n${i.text}`, run: (i) => browserType(i) },
  { name: "add_reminder", safe: false, description: "Add a new Apple Reminder. Mac only. input: {text, list?}. list defaults to 'Reminders'.", params: "{text, list?}",
    activity: (i) => `Adding reminder: ${i.text}`, preview: (i) => `Add Reminder to ${i.list || 'Reminders'}:\n${i.text}`,
    run: async (i) => {
      if (!IS_MAC) return "Apple Reminders only works on macOS.";
      try {
        const l = i.list || "Reminders";
        await osa(`tell application "Reminders"
  tell list "${esc(l)}"
    make new reminder with properties {name:"${esc(i.text)}"}
  end tell
end tell`);
        return `Added reminder '${i.text}'.`;
      } catch (e: any) { return `Couldn't add reminder: ${e.message}`; }
    } },
  { name: "read_apple_mail", safe: true, description: "Read unread emails from Apple Mail on macOS. Returns the sender, subject, date, and body snippet. input: {limit?: number}.", params: "{limit}",
    activity: () => `Checking Apple Mail inbox`,
    run: async (i) => {
      if (!IS_MAC) return "Apple Mail integration only works on macOS.";
      const limit = i.limit || 5;
      const script = `
        tell application "Mail"
          set unreadMsgs to (messages of inbox whose read status is false)
          set out to ""
          set counter to 0
          repeat with msg in unreadMsgs
            if counter is ${limit} then exit repeat
            set out to out & "---" & return
            set out to out & "From: " & sender of msg & return
            set out to out & "Subject: " & subject of msg & return
            set out to out & "Date: " & date sent of msg & return
            set bodyText to content of msg
            if (length of bodyText) > 500 then
              set out to out & "Body: " & (text 1 thru 500 of bodyText) & "..." & return
            else
              set out to out & "Body: " & bodyText & return
            end if
            set counter to counter + 1
          end repeat
          if out is "" then return "No unread emails."
          return out
        end tell
      `;
      try { return await osa(script); } catch (e: any) { return `Failed to read Mail: ${e.message}`; }
    } },
  { name: "draft_apple_mail", safe: false, description: "Draft a new email in Apple Mail (does not send it, just opens the draft window). input: {recipient, subject, body}.", params: "{recipient, subject, body}",
    activity: (i) => `Drafting email to ${i.recipient}`, preview: (i) => `To: ${i.recipient}\nSubject: ${i.subject}\n\n${i.body}`,
    run: async (i) => {
      if (!IS_MAC) return "Apple Mail integration only works on macOS.";
      const script = `
        tell application "Mail"
          set newMsg to make new outgoing message with properties {subject:"${esc(i.subject)}", content:"${esc(i.body)}", visible:true}
          tell newMsg
            make new to recipient at end of to recipients with properties {address:"${esc(i.recipient)}"}
          end tell
          activate
        end tell
      `;
      try { await osa(script); return "Draft created and opened in Apple Mail."; } catch (e: any) { return `Failed to draft Mail: ${e.message}`; }
    } },
  { name: "run_shortcut", safe: false, description: "Run an Apple Shortcut by name (HomeKit, Automations, etc). input: {name}.", params: "{name}",
    activity: (i) => `Running Shortcut: ${i.name}`, preview: (i) => `Run Shortcut:\n${i.name}`,
    run: async (i) => {
      if (!IS_MAC) return "Shortcuts only work on macOS.";
      try {
        const { stdout } = await sh(`shortcuts run "${esc(i.name)}"`);
        return stdout || `Ran shortcut '${i.name}'.`;
      } catch (e: any) { return `Shortcut failed: ${e.message}`; }
    } },
  { name: "list_shortcuts", safe: true, description: "List all available Apple Shortcuts on this Mac.", params: "(none)",
    activity: () => `Listing available Shortcuts`,
    run: async () => {
      if (!IS_MAC) return "Shortcuts only work on macOS.";
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
    activity: (i) => `Setting volume`, preview: (i) => `Set volume to ${i.level ?? i}%`, run: (i) => setVolume(i.level ?? i) },
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
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

// Tool catalogue injected into the model's system prompt.
// Pass a subset of names to expose only the relevant tools (smarter + cheaper).
export function toolCatalogue(names?: string[]): string {
  const list = names ? TOOLS.filter((t) => names.includes(t.name)) : TOOLS;
  return list.map((t) => `- ${t.name}(${t.params})${t.safe ? "" : " [asks first]"}: ${t.description}`).join("\n");
}
