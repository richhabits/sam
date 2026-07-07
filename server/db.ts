// One place to open better-sqlite3. In a packaged Electron app the module gets BUNDLED (the
// electron bundler ignores `external`), so its `bindings` helper searches inside the read-only
// app.asar and can't find better_sqlite3.node — which actually lives in app.asar.unpacked. preboot
// sets SAM_SQLITE_BINDING to the real path; we pass it explicitly so bindings' guesswork is skipped.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";

export function openDb(file: string): Database.Database {
  const binding = process.env.SAM_SQLITE_BINDING;
  return binding && existsSync(binding)
    ? new Database(file, { nativeBinding: binding })
    : new Database(file);
}

export type { Database };
