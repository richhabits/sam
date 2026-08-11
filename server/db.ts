// One place to open better-sqlite3. In a packaged Electron app the module gets BUNDLED (the
// electron bundler ignores `external`), so its `bindings` helper searches inside the read-only
// app.asar and can't find better_sqlite3.node — which actually lives in app.asar.unpacked. preboot
// sets SAM_SQLITE_BINDING to the real path; we pass it explicitly so bindings' guesswork is skipped.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export function openDb(file: string): Database.Database {
  const binding = process.env.SAM_SQLITE_BINDING;
  const db = binding && existsSync(binding)
    ? new Database(file, { nativeBinding: binding })
    : new Database(file);

  // vault/memory.db is opened by THREE modules — memory.ts, notebook.ts and ingest.ts — each with
  // its own handle, and by a second PROCESS entirely when the 04:00 benchmark loop runs while the
  // server is up. On the defaults that is a rollback journal with no busy timeout, so the moment
  // two handles want the file at once better-sqlite3 throws SQLITE_BUSY synchronously — no retry,
  // no wait — and the caller sees "database is locked" for a write that was merely contended.
  // Nothing in the codebase catches SQLITE_BUSY, so it surfaces as a failed save.
  //
  //   WAL          readers no longer block the writer, which removes most of the contention
  //                outright rather than making it wait.
  //   busy_timeout a writer that IS blocked waits up to 5s instead of failing instantly.
  //
  // Set here because openDb is the one door every handle comes through — set per-module and the
  // fourth module to be written is the one that forgets.
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
  } catch {
    // A filesystem that refuses WAL (some network mounts) still gives a working database on the
    // rollback journal — degraded, not broken. Never let a tuning pragma stop SAM from opening.
  }
  return db;
}

export type { Database };
