import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// EVERY DATABASE IN SAM MUST BE OPENED THROUGH openDb().
//
// Not a style rule. In a packaged Electron app the bundler ignores `external`, so better-sqlite3
// is bundled and its own resolver looks for the native binary INSIDE the read-only app.asar.
// electron/preboot.ts locates the real one under app.asar.unpacked and exports the path as
// SAM_SQLITE_BINDING; openDb() is the single place that passes it to the constructor.
//
// A file that calls `new Database(...)` directly therefore works perfectly in every test, every
// typecheck and every lint — and dies on launch in the packaged app with
// "Cannot find module .../app.asar/build/Release/better_sqlite3.node". v3.2.0 shipped that way.
// server/yard/store.ts then did it again, which is why this test exists: the yard was the last
// file not moved onto the shared opener, and the failure is invisible to everything except
// actually running the built app with the yard switched on.

// fileURLToPath, not .pathname — a URL percent-encodes, and if a checkout lives on a
// volume with spaces in the name, .pathname yields percent-encoded paths and every readdir
// throws ENOENT. Any path with a space would do it; this repo tests against paths with spaces.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "dist-app" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("opening a database", () => {
  it("happens only through openDb(), so the packaged app's native binding is always passed", () => {
    const offenders: string[] = [];
    for (const file of [...sources(join(ROOT, "server")), ...sources(join(ROOT, "electron"))]) {
      if (file.endsWith(`${join("server", "db.ts")}`)) continue; // the one place allowed to construct
      const src = readFileSync(file, "utf8");
      if (/\bnew Database\s*\(/.test(src)) offenders.push(file.replace(ROOT, ""));
    }
    expect(
      offenders,
      `these construct better-sqlite3 directly and so ignore SAM_SQLITE_BINDING — the packaged ` +
        `app will die on "Cannot find module .../app.asar/build/Release/better_sqlite3.node". ` +
        `Use openDb() from server/db.ts instead:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps db.ts the only value-importer of better-sqlite3", () => {
    const offenders: string[] = [];
    for (const file of [...sources(join(ROOT, "server")), ...sources(join(ROOT, "electron"))]) {
      if (file.endsWith(`${join("server", "db.ts")}`)) continue;
      const src = readFileSync(file, "utf8");
      // `import type Database from "better-sqlite3"` is fine — a type cannot open a file.
      // A value import is what lets a future edit call the constructor without noticing.
      if (/^\s*import\s+(?!type\b)[^;]*from\s+["']better-sqlite3["']/m.test(src)) {
        offenders.push(file.replace(ROOT, ""));
      }
    }
    expect(offenders, `value-import better-sqlite3; use \`import type\` + openDb():\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

describe("openDb", () => {
  it("opens a database that works", async () => {
    const { openDb } = await import("./db.ts");
    const db = openDb(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t VALUES (?)").run(41);
    expect(db.prepare("SELECT x + 1 AS y FROM t").get()).toEqual({ y: 42 });
    db.close();
  });

  // The fallback matters as much as the binding: a checkout has no SAM_SQLITE_BINDING at all,
  // and must still open normally rather than refusing because the packaged-app path is absent.
  it("falls back to the library's own resolution when no binding is set", async () => {
    const saved = process.env.SAM_SQLITE_BINDING;
    delete process.env.SAM_SQLITE_BINDING;
    try {
      const { openDb } = await import("./db.ts");
      const db = openDb(":memory:");
      expect(db.prepare("SELECT 1 AS n").get()).toEqual({ n: 1 });
      db.close();
    } finally {
      if (saved !== undefined) process.env.SAM_SQLITE_BINDING = saved;
    }
  });

  // A stale path — a binding recorded by an older build, or a bundle that has moved — must not
  // be handed to the constructor, because better-sqlite3 throws on a nativeBinding that is not
  // there. Falling back is always better than failing to open at all.
  it("ignores a binding path that does not exist rather than throwing", async () => {
    const saved = process.env.SAM_SQLITE_BINDING;
    process.env.SAM_SQLITE_BINDING = "/nonexistent/better_sqlite3.node";
    try {
      const { openDb } = await import("./db.ts");
      const db = openDb(":memory:");
      expect(db.prepare("SELECT 1 AS n").get()).toEqual({ n: 1 });
      db.close();
    } finally {
      if (saved === undefined) delete process.env.SAM_SQLITE_BINDING;
      else process.env.SAM_SQLITE_BINDING = saved;
    }
  });
});
