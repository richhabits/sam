import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// WHERE IS THE SQLITE BINARY?
//
// preboot points better-sqlite3 at its native binary explicitly, because in a packaged app the
// module is bundled and its own search looks inside the read-only asar. If that probe misses, it
// misses SILENTLY: SAM_SQLITE_BINDING is never set, db.ts falls back to the library's own
// resolution, and the app dies on launch with "Cannot find module …/app.asar/build/Release/
// better_sqlite3.node".
//
// Nothing else catches it. The suite, typecheck and lint all pass — none of them run the packaged
// app — so the first sign is a published build that will not start. v3.2.0 shipped exactly that
// way on mac-arm64 and Windows, because better-sqlite3 13 moved the binary from
// build/Release/better_sqlite3.node to prebuilds/<platform>-<arch>.node and the probe still looked
// only at the old path.
//
// So this asserts the thing that actually changed: that the INSTALLED library still keeps its
// binary somewhere preboot knows to look. A future bump that moves it again fails here, in a
// second, instead of in a release.

const preboot = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "preboot.ts"), "utf8");
const require_ = createRequire(import.meta.url);

/** The layouts preboot probes, newest first — kept in step with the loop in preboot.ts. */
const LAYOUTS = [
  ["prebuilds", `${process.platform}-${process.arch}.node`],   // v13+
  ["build", "Release", "better_sqlite3.node"],                 // v12, and electron-rebuild output
];

describe("the native sqlite binding preboot hands to better-sqlite3", () => {
  it("still exists in the installed library, under one of the paths preboot looks in", () => {
    const pkgRoot = dirname(require_.resolve("better-sqlite3/package.json"));
    const found = LAYOUTS.map((parts) => join(pkgRoot, ...parts)).filter((p) => existsSync(p));
    expect(
      found.length,
      `better-sqlite3 keeps its binary somewhere preboot does not check. Installed version: ` +
        `${require_("better-sqlite3/package.json").version}. Add the new layout to the loop in ` +
        `electron/preboot.ts, or the packaged app will not launch.`,
    ).toBeGreaterThan(0);
  });

  it("probes BOTH layouts, so a downgrade or an electron-rebuild output is still found", () => {
    expect(preboot).toContain('"prebuilds"');
    expect(preboot).toContain('"build", "Release", "better_sqlite3.node"');
  });

  it("resolves the binding inside app.asar.unpacked, never inside the asar itself", () => {
    // The whole point: the asar is read-only and the .node cannot be loaded from inside it.
    expect(preboot).toContain('"app.asar.unpacked"');
    expect(preboot).not.toMatch(/join\([^)]*"app\.asar"[^)]*better-sqlite3/);
  });

  it("sets the env var db.ts reads, and stops at the first hit", () => {
    expect(preboot).toContain("process.env.SAM_SQLITE_BINDING = candidate");
    expect(preboot).toContain("break;");
  });
});
