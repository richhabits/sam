/**
 * No runtime circular imports in server/.
 *
 * Two existed until 2026-07-18: forge.ts ⇄ tools.ts and selftest.ts ⇄ tools.ts, both because a
 * module imported TOOLS (a value) while tools.ts imported back into it. ESM tolerates that, so
 * nothing failed — it just made module-initialisation order load-bearing and undocumented, the
 * kind of thing that breaks confusingly when someone reorganises a file months later.
 *
 * Fixed by inverting: selftest RECEIVES the tool list, forge has the registry BOUND into it. This
 * test stops either creeping back, and stops a new pair forming elsewhere.
 *
 * `import type` is deliberately excluded — it is erased at compile time and cannot create a
 * runtime cycle. metrics.ts ⇄ models.ts looks like one and isn't, which is exactly the kind of
 * false positive that gets "fixed" into a worse shape.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { describe, it, expect } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function valueImports(file: string): Set<string> {
  const src = readFileSync(join(root, file), "utf8");
  const out = new Set<string>();
  for (const m of src.matchAll(/^import\s+(type\s+)?(?:\{([^}]*)\}|\w+)\s+from "\.\/([a-zA-Z0-9_.-]+)\.ts"/gm)) {
    if (m[1]) continue;                                        // `import type { ... }`
    const names = (m[2] ?? "").split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length && names.every((n) => n.startsWith("type "))) continue;   // all inline-type
    out.add(m[3]);
  }
  return out;
}

describe("module graph", () => {
  const files = execSync("git ls-files server", { cwd: root, encoding: "utf8" })
    .split("\n").filter((f) => f.endsWith(".ts") && !f.includes(".test."));
  const graph = new Map(files.map((f) => [basename(f, ".ts"), valueImports(f)]));

  it("parses a real graph (guard: worthless if this breaks)", () => {
    expect(graph.size).toBeGreaterThan(30);
    expect(graph.get("tools")?.size ?? 0).toBeGreaterThan(5);
  });

  it("has no runtime circular imports", () => {
    const cycles: string[] = [];
    for (const [a, deps] of graph) {
      for (const b of deps) {
        if (graph.get(b)?.has(a) && !cycles.includes(`${b} ⇄ ${a}`)) cycles.push(`${a} ⇄ ${b}`);
      }
    }
    expect(cycles, `circular imports: ${cycles.join(", ")}`).toEqual([]);
  });

  it("forge and selftest still get the registry injected, not imported", () => {
    // The specific inversion that removed the two cycles — if someone re-imports TOOLS to "fix"
    // a signature, the cycle returns and this says so before it lands.
    expect(readFileSync(join(root, "server/forge.ts"), "utf8")).toMatch(/export function bindToolRegistry/);
    expect(readFileSync(join(root, "server/tools.ts"), "utf8")).toMatch(/bindToolRegistry\(TOOLS\)/);
    expect(valueImports("server/forge.ts").has("tools")).toBe(false);
    expect(valueImports("server/selftest.ts").has("tools")).toBe(false);
  });
});
