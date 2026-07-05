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
import { homedir } from "node:os";
import { resolve, dirname, basename } from "node:path";
import { hasJina, jinaSearch, jinaRead } from "./jina.ts";
import { fetchLocation, nowText } from "./context.ts";
import { grabRepos, loadSocials } from "./world.ts";
import { logSecurity, securityStatus } from "./security.ts";

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

// git in a specific local repo folder (handles spaces in paths like "My Drive").
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
    const { stdout, stderr } = await sh(cmd, { timeout: 60000, cwd: homedir(), maxBuffer: 8 * 1024 * 1024 });
    return clip((stdout || "") + (stderr ? `\n[stderr] ${stderr}` : "")) || "(command finished, no output)";
  } catch (e: any) {
    return `Command failed: ${e?.message || e}`.slice(0, 2000);
  }
}

// ── FILES ────────────────────────────────────────────────────
const safePath = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));
async function readFileTool(path: string): Promise<string> {
  try { return clip(await readFile(safePath(path), "utf8")); }
  catch (e: any) { return `Could not read ${path}: ${e?.message}`; }
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
  // Terminal confirmation — do NOT invite another tool call (prevents loops).
  return `DONE — ${query} is now playing (latest first). Confirm it's on in ONE short line with a bit of swagger. Do not call any more tools.`;
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
    const out = await osa(`set out to ""
tell application "Mail"
  set msgs to messages 1 thru 10 of inbox
  repeat with m in msgs
    set out to out & (sender of m) & " — " & (subject of m) & linefeed
  end repeat
end tell
return out`);
    return clip(out.trim()) || "Inbox looks empty (or Mail isn't set up).";
  } catch (e: any) { return `Couldn't read Mail: ${e?.message}`; }
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
  { name: "get_location", safe: true, description: "Get the user's current approximate location (city/region).", params: "(none)",
    activity: () => `Checking your location`, run: async () => (await fetchLocation(true)) || "Couldn't determine location (offline?)." },
  { name: "notify", safe: true, description: "Show a macOS notification. input: {title?, message}.", params: "{title?, message}",
    activity: (i) => `Sending a notification`, run: (i) => notify(i) },
  { name: "get_weather", safe: true, description: "Get current weather. input: a place name (city).", params: "place",
    activity: (i) => `Checking the weather in ${i.place ?? i ?? "your area"}`, run: (i) => getWeather(i.place ?? i ?? "") },
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
  { name: "read_reminders", safe: true, description: "Read your open reminders / to-dos.", params: "(none)",
    activity: () => `Checking your reminders`, run: readReminders },
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
  { name: "send_email", safe: false, description: "Send an email via Mail. input: {to, subject?, body}.", params: "{to, subject?, body}",
    activity: (i) => `Sending an email to ${i.to}`, preview: (i) => `Send email\n  To: ${i.to}\n  Subject: ${i.subject || "(none)"}\n\n${i.body}`, run: (i) => sendEmail(i) },
  { name: "send_imessage", safe: false, description: "Send an iMessage/text. input: {to, message}.", params: "{to, message}",
    activity: (i) => `Texting ${i.to}`, preview: (i) => `Send iMessage\n  To: ${i.to}\n  ${i.message}`, run: (i) => sendIMessage(i) },
  { name: "add_reminder", safe: false, description: "Add a reminder. input: {text, list?}.", params: "{text, list?}",
    activity: (i) => `Adding a reminder`, preview: (i) => `Add reminder: ${i.text}${i.list?` (list: ${i.list})`:""}`, run: (i) => addReminder(i) },
  { name: "add_calendar_event", safe: false, description: "Add a calendar event. input: {title, start?, calendar?}. start like \"January 5, 2026 3:00 PM\".", params: "{title, start?, calendar?}",
    activity: (i) => `Adding a calendar event`, preview: (i) => `Add event: ${i.title}${i.start?` at ${i.start}`:""}`, run: (i) => addCalendarEvent(i) },
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
];

export const toolByName = (n: string) => TOOLS.find((t) => t.name === n);

// Tool catalogue injected into the model's system prompt.
// Pass a subset of names to expose only the relevant tools (smarter + cheaper).
export function toolCatalogue(names?: string[]): string {
  const list = names ? TOOLS.filter((t) => names.includes(t.name)) : TOOLS;
  return list.map((t) => `- ${t.name}(${t.params})${t.safe ? "" : " [asks first]"}: ${t.description}`).join("\n");
}
