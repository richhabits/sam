#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  better-sqlite3, TWICE — one binary per ABI.
//
//  The server (server/index.ts) runs under Node; the desktop shell runs under
//  Electron. They have DIFFERENT native ABIs (Node 20 = 115, Electron 43 = 148) and
//  better-sqlite3 ships exactly one compiled .node. Rebuilding it for Electron —
//  `electron-rebuild`, `electron-builder install-app-deps` — overwrites the Node
//  build in place and breaks the server, which is why `npm run dev:hud` used to die
//  with "Could not locate the bindings file" and why the naive fix is worse than the
//  bug. Packaged releases are unaffected: electron-builder handles ABI at packaging
//  time (see build:mac), so this is a DEV-ONLY concern.
//
//  So: build for Electron, park that copy at ./build/Release (gitignored) — a path
//  `bindings()` already searches, because vite-plugin-electron inlines better-sqlite3
//  into dist-electron/main.js in serve mode and resolution then walks up from the
//  bundle to the repo root — and put the Node build back where it was. Neither
//  runtime can see the other's binary.
//
//  Run after any `npm install` that rebuilds better-sqlite3:  npm run electron:sqlite
// ─────────────────────────────────────────────────────────────
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG = join(ROOT, "node_modules", "better-sqlite3");
const NODE_BUILT = join(PKG, "build", "Release", "better_sqlite3.node");
const PARKED = join(ROOT, "build", "Release", "better_sqlite3.node");
// OUTSIDE the package's build/ dir on purpose: `node-gyp rebuild` cleans that whole
// directory before compiling, so a backup kept in there is deleted by the very command
// it exists to protect against — and the restore then fails, leaving the SERVER holding
// an Electron-ABI binary it cannot load. Found the hard way.
const BACKUP = join(tmpdir(), "sam-better_sqlite3.node-abi.bak");

const electronVersion = JSON.parse(readFileSync(join(ROOT, "node_modules", "electron", "package.json"), "utf8")).version;
const force = process.argv.includes("--force");

if (existsSync(PARKED) && !force) {
  console.log("✓ Electron-ABI better_sqlite3 already parked at build/Release — nothing to do (--force to rebuild).");
  process.exit(0);
}
if (!existsSync(NODE_BUILT)) {
  console.error("✗ node_modules/better-sqlite3 has no Node build to protect. Run `npm install` first.");
  process.exit(1);
}

// Keep the Node build safe FIRST — node-gyp writes over it, and a failed compile
// partway through must not leave the server without a binary it can load.
copyFileSync(NODE_BUILT, BACKUP);
try {
  console.log(`• building better-sqlite3 against Electron ${electronVersion} headers…`);
  execFileSync(
    "npx",
    ["node-gyp", "rebuild", "--runtime=electron", `--target=${electronVersion}`, `--arch=${process.arch}`, "--dist-url=https://electronjs.org/headers"],
    { cwd: PKG, stdio: "inherit" },
  );
  mkdirSync(dirname(PARKED), { recursive: true });
  copyFileSync(NODE_BUILT, PARKED);
  console.log("• parked the Electron-ABI copy at build/Release/better_sqlite3.node");
} finally {
  // Always hand the server back its own binary, compile succeeded or not. node-gyp may
  // have removed build/Release entirely (a failed compile never recreates it), so make
  // sure there's somewhere to put it back.
  mkdirSync(dirname(NODE_BUILT), { recursive: true });
  copyFileSync(BACKUP, NODE_BUILT);
  console.log("• restored the Node-ABI build in node_modules — the server is untouched");
}
console.log("✓ done. `npm run dev:hud` can launch Electron; `tsx server/index.ts` still runs.");
