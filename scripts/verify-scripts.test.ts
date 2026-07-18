import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// FOUR verify scripts have now shipped importing a sibling ".mjs" that was never landed. Each one
// threw ERR_MODULE_NOT_FOUND on every invocation while its strip doc advertised a passing score
// ("9/9", "4/4", "6/6"). A verification script that cannot execute is worse than none: it reports
// success by existing, and nobody re-runs it because the number is already written down.
//
// The lesson didn't transfer between scripts three times, so it's enforced here instead.

const here = dirname(fileURLToPath(import.meta.url));

describe("verify scripts can actually run", () => {
  const scripts = readdirSync(here).filter((f) => /^verify-.*\.mjs$/.test(f));

  it("finds the verify scripts (guard: this test is worthless if the glob breaks)", () => {
    expect(scripts.length).toBeGreaterThan(2);
  });

  it("every import resolves to a file that exists", () => {
    const broken: string[] = [];
    for (const file of scripts) {
      const src = readFileSync(join(here, file), "utf8");
      for (const m of src.matchAll(/^\s*import\s[^"']*["'](\.[^"']+)["']/gm)) {
        const target = resolve(here, m[1]);
        if (!existsSync(target)) broken.push(`${file} imports ${m[1]} — no such file`);
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });

  it("none import a sibling .mjs that should be a server module", () => {
    // The exact recurring shape: `from "./thing.mjs"` when the real module is ../server/thing.ts.
    // Called out separately so the failure message names the actual mistake rather than a path.
    const wrong: string[] = [];
    for (const file of scripts) {
      const src = readFileSync(join(here, file), "utf8");
      for (const m of src.matchAll(/^\s*import\s[^"']*["']\.\/([\w-]+)\.mjs["']/gm)) {
        if (existsSync(join(here, "..", "server", `${m[1]}.ts`))) {
          wrong.push(`${file}: imports "./${m[1]}.mjs" but the module is server/${m[1]}.ts`);
        }
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
  });
});
