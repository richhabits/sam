// Runs BEFORE the server module is imported by main.ts (it's the first import there). Sets up
// everything the server's boot depends on: CJS globals for bundled deps, crash visibility, and the
// writable per-user data directory. Kept separate so a STATIC `import "../server/index.ts"` in main
// can follow it — a static import lets the electron build's `external` (better-sqlite3) apply, so the
// native module loads from node_modules (asar.unpacked) instead of being bundled and losing its .node.
import { app } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// The bundler emits ESM, but bundled CommonJS deps may reference the CJS globals __filename/__dirname,
// which don't exist in ESM scope. Define them on globalThis so those undeclared references resolve.
(globalThis as any).__filename = fileURLToPath(import.meta.url);
(globalThis as any).__dirname = path.dirname(fileURLToPath(import.meta.url));

// Surface boot failures — the server boots in this process; without this a startup throw would vanish
// (Electron swallows main-process errors) and the app would hang with a blank window.
const _errLog = path.join(os.tmpdir(), "sam-main-error.log");
process.on("uncaughtException", (e: any) => { try { fs.appendFileSync(_errLog, `[uncaught] ${e?.stack || e}\n`); } catch { /* the crash logger must never itself crash — that would hide the original error */ }; console.error("SAM uncaughtException:", e?.stack || e); });
process.on("unhandledRejection", (e: any) => { try { fs.appendFileSync(_errLog, `[reject] ${e?.stack || e}\n`); } catch { /* the crash logger must never itself crash — that would hide the original error */ }; console.error("SAM unhandledRejection:", e); });

// Packaged app: the .app bundle is READ-ONLY, so the server's data — the vault (memory, notebooks,
// photos, keys) and the .env it writes config to — must live in a writable per-user directory.
if (app.isPackaged) {
  const dataDir = app.getPath("userData");
  process.env.VAULT_DIR = process.env.VAULT_DIR || path.join(dataDir, "vault");
  process.env.DOTENV_CONFIG_PATH = process.env.DOTENV_CONFIG_PATH || path.join(dataDir, ".env");
  try { fs.mkdirSync(process.env.VAULT_DIR, { recursive: true }); } catch { /* vault dir may be on an unmounted volume — the app reports it properly later */ }
  // better-sqlite3 gets bundled (external is ignored), so point it directly at its native binary,
  // which electron-builder unpacks outside the asar. Skips `bindings`' failing in-asar search.
  const nb = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
  if (fs.existsSync(nb)) process.env.SAM_SQLITE_BINDING = nb;
}
