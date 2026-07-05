// ─────────────────────────────────────────────────────────────
//  S.A.M. · iOS COMPANION (iCloud Drop)
//  Watches a shared iCloud Drive folder for text/voice notes
//  dropped by an Apple Shortcut on the user's iPhone/Watch.
//  When a file appears, SAM processes it and deletes the drop.
//
//  Works on any OS that syncs iCloud Drive (macOS natively,
//  Windows via iCloud for Windows). On Linux, falls back to a
//  configurable local drop folder.
// ─────────────────────────────────────────────────────────────

import { watch, readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { homedir } from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const sh = promisify(exec);

// ── Resolve the drop folder (cross-platform) ──
function resolveDropFolder(): string {
  // Explicit override always wins.
  if (process.env.SAM_DROP_FOLDER) return process.env.SAM_DROP_FOLDER;

  const home = homedir();
  if (process.platform === "darwin") {
    // macOS: native iCloud Drive path.
    return join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "SAM_Drop");
  }
  if (process.platform === "win32") {
    // Windows: iCloud for Windows syncs here by default.
    return join(home, "iCloudDrive", "SAM_Drop");
  }
  // Linux / other: local drop folder in home (user can mount their cloud sync here).
  return join(home, "SAM_Drop");
}

const DROP = resolveDropFolder();

export interface DropResult {
  file: string;
  content: string;
  kind: "text" | "voice-transcript";
  at: string;
}

// Queue of processed drops for the app to consume.
let drops: DropResult[] = [];
export function takeDrop(): DropResult[] { const d = drops; drops = []; return d; }

// Transcribe a voice memo (m4a/wav/mp3) using macOS `say` + whisper or fallback to filename hint.
async function transcribeAudio(path: string): Promise<string> {
  // If whisper CLI is available, use it (free, local).
  try {
    const { stdout } = await sh(`which whisper 2>/dev/null && whisper "${path}" --model tiny --output_format txt --output_dir /tmp 2>/dev/null && cat /tmp/${basename(path, extname(path))}.txt`, { timeout: 60000 });
    if (stdout.trim()) return stdout.trim();
  } catch {}
  // Fallback: can't transcribe, just note that a voice memo was dropped.
  return `[Voice memo dropped: ${basename(path)} — install whisper for auto-transcription: pip install openai-whisper]`;
}

// Process a single file from the drop folder.
async function processFile(filename: string): Promise<DropResult | null> {
  const path = join(DROP, filename);
  if (!existsSync(path)) return null;
  const ext = extname(filename).toLowerCase();

  let content = "";
  let kind: "text" | "voice-transcript" = "text";

  if ([".txt", ".md", ".json"].includes(ext)) {
    content = readFileSync(path, "utf8").trim();
  } else if ([".m4a", ".wav", ".mp3", ".caf", ".aac"].includes(ext)) {
    content = await transcribeAudio(path);
    kind = "voice-transcript";
  } else {
    // Unknown file type — skip it (don't delete so user can inspect).
    return null;
  }

  if (!content) return null;

  // Clean up the drop file after processing.
  try { unlinkSync(path); } catch {}

  return { file: filename, content, kind, at: new Date().toISOString() };
}

// Scan the folder once for any existing files (catches things that synced while SAM was off).
async function scanExisting(): Promise<DropResult[]> {
  if (!existsSync(DROP)) return [];
  const results: DropResult[] = [];
  for (const f of readdirSync(DROP)) {
    if (f.startsWith(".")) continue;
    const r = await processFile(f);
    if (r) results.push(r);
  }
  return results;
}

let watcher: ReturnType<typeof watch> | null = null;
let onDrop: ((d: DropResult) => void) | null = null;

// Start watching the iCloud Drop folder.
export function startDropWatcher(handler: (d: DropResult) => void) {
  onDrop = handler;

  // Ensure the folder exists.
  try { mkdirSync(DROP, { recursive: true }); } catch {}

  // Process anything already sitting there.
  void scanExisting().then((results) => {
    for (const r of results) {
      drops.push(r);
      handler(r);
    }
  });

  // Watch for new files.
  try {
    watcher = watch(DROP, async (event, filename) => {
      if (!filename || filename.startsWith(".") || event !== "rename") return;
      // Small delay to let iCloud finish syncing the file.
      await new Promise((r) => setTimeout(r, 1500));
      const result = await processFile(filename);
      if (result) {
        drops.push(result);
        if (onDrop) onDrop(result);
      }
    });
    console.log(`  📱 iOS companion · watching ${DROP}`);
  } catch (e: any) {
    console.log(`  📱 iOS companion · folder ready at ${DROP} (watcher unavailable: ${e.message})`);
  }
}

export function stopDropWatcher() {
  if (watcher) { watcher.close(); watcher = null; }
}

// Where the drop folder lives (for docs / shortcut setup).
export function dropFolderPath(): string { return DROP; }
