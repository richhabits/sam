/**
 * Provider identity used to live in FIVE hand-maintained lists (models.ts, keys.ts,
 * index.ts PROVIDER_ENV, src/Admin.tsx, .env.example). Nothing kept them in step, and on
 * 2026-07-18 that drift produced four bugs in one day — 19 providers undocumented, `hermes`
 * offered in Settings but unsaveable (400), baidu/tencent/volcengine invisible, `leonardo`
 * posted to the wrong endpoint.
 *
 * They now DERIVE from server/providers.registry.ts. These tests hold that line: they check the
 * derivation is real (not a copy that will drift again), that the one remaining hand-written
 * list — models.ts's run() closures — still matches, and that the refactor didn't reopen the
 * security gate.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PROVIDER_REGISTRY, POOLED, PROVIDER_ENV, uiCatalogue } from "./providers.registry.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const models = read("server/models.ts");
const admin = read("src/Admin.tsx");
const index = read("server/index.ts");
const keys = read("server/keys.ts");
const envExample = read(".env.example");

const all = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m[1]);
const runtime = all(/\{ id: "([a-z0-9-]+)", tier:/g, models);
const noKey = new Set(all(/\{ id: "([a-z0-9-]+)", tier: "free", noKey: true/g, models));
const registryIds = new Set(PROVIDER_REGISTRY.map((p) => p.id));

describe("the registry is the single source", () => {
  it("every runtime provider that takes a key is in the registry", () => {
    // models.ts still hand-lists run() closures — that's BEHAVIOUR, deliberately separate.
    // But its ids must exist here, or a brain can run with no way to give it a key.
    const orphans = runtime.filter((id) => !noKey.has(id) && !registryIds.has(id));
    expect(orphans, `runtime providers missing from the registry: ${orphans.join(", ")}`).toEqual([]);
  });

  it("every registry entry is actually used somewhere", () => {
    // Not every entry is a chat brain: `fal` and `leonardo` are image/video backends consumed by
    // tools.ts. The rule that matters is that nothing sits in the registry unused — a provider
    // offered in Settings that no code ever calls is a key the user wastes time obtaining.
    const tools = read("server/tools.ts");
    const dead = PROVIDER_REGISTRY.filter((p) => !runtime.includes(p.id) && !tools.includes(`"${p.id}"`));
    expect(dead.map((p) => p.id), "offered in Settings but never used by any code").toEqual([]);
  });

  it("pools and PROVIDER_ENV are DERIVED, not copies", () => {
    // If someone re-hardcodes either list, these break — which is the whole point.
    expect(keys).toContain("POOLED.map(");
    expect(index).toContain("REGISTRY_ENV");
    expect(POOLED.length).toBe(PROVIDER_REGISTRY.filter((p) => p.envPlural && p.envSingular).length);
    expect(Object.keys(PROVIDER_ENV).length).toBeGreaterThanOrEqual(POOLED.length);
  });

  it("Settings has no hardcoded provider list of its own", () => {
    // src/ never imports server/; the UI renders what /api/admin/config sends. A literal list
    // reappearing here is the fifth copy coming back.
    expect(admin).not.toMatch(/const PROVIDERS:\s*Prov\[\]\s*=\s*\[/);
    expect(index).toContain("uiCatalogue()");
  });

  it("the UI catalogue never leaks env var names", () => {
    expect(JSON.stringify(uiCatalogue())).not.toMatch(/API_KEY/);
  });

  it("every pooled provider is documented in .env.example", () => {
    const missing = POOLED.filter((p) => !envExample.includes(p.envPlural!) && !envExample.includes(p.envSingular!));
    expect(missing.map((p) => p.id), "undocumented — invisible to anyone setting up").toEqual([]);
  });
});

describe("credential writes stay local-only", () => {
  it("/api/admin/keys and /api/admin/config are loopback-gated", () => {
    // CONFIG_ENV can write the Slack token, Discord webhook, Notion/Linear and Cloudflare keys —
    // a remote token-holder must not be able to redirect SAM's outbound integrations.
    for (const route of ['app.post("/api/admin/keys"', 'app.post("/api/admin/config"']) {
      const at = index.indexOf(route);
      expect(at, `${route} not found`).toBeGreaterThan(-1);
      expect(index.slice(at, at + 700)).toContain("isLoopback(req)");
    }
  });
});
