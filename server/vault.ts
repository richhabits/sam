// ─────────────────────────────────────────────────────────────
//  SAM · VAULT  (THE MEMORY)
//  Plain markdown becomes long-term memory. No database.
//  Every exchange lands as an Obsidian-compatible .md file with
//  [[wikilinks]] so notes form a graph SAM can traverse.
//
//  OPTIMISATION: graph results are cached in memory and only
//  recomputed when logExchange writes a new entry.
// ─────────────────────────────────────────────────────────────

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const DAILY_DIR = join(VAULT_DIR, "daily");
const PROJECTS_DIR = join(VAULT_DIR, "projects");

function ensure(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
ensure(DAILY_DIR);

// Self-containment: daily logs auto-expire. Keeps the vault lean forever, for free.
// Recent context stays; ancient chatter is pruned. Override window with SAM_LOG_DAYS.
export function pruneOldLogs(): { removed: number } {
  const days = Number(process.env.SAM_LOG_DAYS) || 90;
  const cutoff = Date.now() - days * 86_400_000;
  let removed = 0;
  try {
    for (const f of readdirSync(DAILY_DIR)) {
      if (!f.endsWith(".md")) continue;
      const p = join(DAILY_DIR, f);
      try { if (statSync(p).mtimeMs < cutoff) { unlinkSync(p); removed++; } } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  if (removed) graphCache = null; // pruning invalidates graph
  return { removed };
}
ensure(PROJECTS_DIR);

const today = () => new Date().toISOString().slice(0, 10);
const stamp = () =>
  new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// Append an exchange to today's daily note (the running log)
export function logExchange(opts: {
  user: string;
  sam: string;
  skill?: string;
  project?: string;
  provider: string;
}) {
  const file = join(DAILY_DIR, `${today()}.md`);
  if (!existsSync(file)) {
    writeFileSync(
      file,
      `---\ntype: daily\ndate: ${today()}\n---\n\n# ${today()} — SAM log\n\n`
    );
  }
  const links = [
    opts.skill ? `[[skill-${opts.skill}]]` : "",
    opts.project ? `[[${opts.project}]]` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const entry =
    `### ${stamp()} ${links}\n` +
    `**the user:** ${opts.user}\n\n` +
    `**SAM** (${opts.provider}): ${opts.sam}\n\n---\n\n`;
  appendFileSync(file, entry);
  graphCache = null; // invalidate graph on new write
}

// projectId arrives from the chat request body and becomes a filename, so an unchecked
// "../../.." would read any .md on disk. Ids are slugs; anything else means "no such note".
const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function isValidProjectId(id: string): boolean { return PROJECT_ID_RE.test(id || ""); }

// Read a project note (used to give SAM deep context on demand)
export function readProjectNote(projectId: string): string {
  if (!isValidProjectId(projectId)) return "";
  const file = join(PROJECTS_DIR, `${projectId}.md`);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

// Recent log lines for the HUD vault panel
export function recentLog(limit = 12): { time: string; msg: string }[] {
  const file = join(DAILY_DIR, `${today()}.md`);
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n");
  const out: { time: string; msg: string }[] = [];
  for (const line of lines) {
    const m = line.match(/^### (\d{2}:\d{2})/);
    if (m) out.push({ time: m[1], msg: line.replace(/^### /, "") });
  }
  return out.slice(-limit).reverse();
}

// Recent actual exchanges (user + SAM text) from today's note — real recall.
export function recentExchanges(limit = 5): { user: string; sam: string }[] {
  const file = join(DAILY_DIR, `${today()}.md`);
  if (!existsSync(file)) return [];
  // Only the last `limit` blocks are needed — regex-parsing the WHOLE day's log
  // every request got slower as the day grew. Slice first, then parse.
  const blocks = readFileSync(file, "utf8").split(/^### /m).slice(1).slice(-limit);
  const out: { user: string; sam: string }[] = [];
  for (const b of blocks) {
    const u = b.match(/\*\*the user:\*\*\s*([\s\S]*?)\n\n\*\*SAM/);
    const s = b.match(/\*\*SAM\*\*[^:]*:\s*([\s\S]*?)\n\n---/);
    if (u || s) out.push({ user: (u?.[1] || "").trim(), sam: (s?.[1] || "").trim() });
  }
  return out;
}

// ── In-memory graph cache ────────────────────────────────────
// Avoids scanning every .md file on the SSD for every HUD render.
// Invalidated by logExchange() and pruneOldLogs().
let graphCache: { nodes: { id: string; group: string }[]; edges: { from: string; to: string }[] } | null = null;

// Build a lightweight graph: notes = nodes, [[links]] = edges.
// Powers the HUD memory visual without any external DB.
export function buildGraph() {
  if (graphCache) return graphCache;

  const nodes: { id: string; group: string }[] = [];
  const edges: { from: string; to: string }[] = [];
  const seen = new Set<string>();

  const scan = (dir: string, group: string) => {
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md"))) {
      const id = f.replace(/\.md$/, "");
      if (!seen.has(id)) { nodes.push({ id, group }); seen.add(id); }
      const content = readFileSync(join(dir, f), "utf8");
      for (const link of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const to = link[1];
        if (!seen.has(to)) { nodes.push({ id: to, group: "link" }); seen.add(to); }
        edges.push({ from: id, to });
      }
    }
  };

  scan(PROJECTS_DIR, "project");
  scan(DAILY_DIR, "daily");
  graphCache = { nodes, edges };
  return graphCache;
}

export function vaultStats() {
  const count = (d: string) =>
    existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".md")).length : 0;
  return {
    projectNotes: count(PROJECTS_DIR),
    dailyNotes: count(DAILY_DIR),
    path: VAULT_DIR,
  };
}

