/**
 * Provider identity lives in FIVE places, and every provider bug found on 2026-07-18 was drift
 * between them:
 *   server/models.ts   — the runtime provider list + lane preferences
 *   server/keys.ts     — the rotating key pools
 *   server/index.ts    — PROVIDER_ENV (what /api/admin/keys can actually save)
 *   src/Admin.tsx      — what Settings offers
 *   .env.example       — what a human setting up can discover
 *
 * The bugs: 19 providers missing from .env.example (invisible to setup) · `hermes` offered in
 * Settings but absent from PROVIDER_ENV, so saving a key returned 400 · baidu/tencent/volcengine
 * wired but absent from the UI · `leonardo` posted to the wrong endpoint.
 *
 * The real fix is ONE registry the rest derive from — a refactor across shared files, filed as
 * the next step. Until then this test makes the invariant enforced rather than hoped: adding a
 * provider to one list and forgetting the others now fails CI instead of shipping silently.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const models = read("server/models.ts");
const keys = read("server/keys.ts");
const index = read("server/index.ts");
const admin = read("src/Admin.tsx");
const envExample = read(".env.example");

const all = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m[1]);

const runtime = new Set(all(/\{ id: "([a-z0-9-]+)", tier:/g, models));
const noKey = new Set(all(/\{ id: "([a-z0-9-]+)", tier: "free", noKey: true/g, models));
const pools = new Set(all(/^\s*([a-z0-9]+):\s*readPool\(/gm, keys));
const envBlock = index.slice(index.indexOf("const PROVIDER_ENV"), index.indexOf("const CONFIG_ENV"));
const saveable = new Set(all(/([a-z0-9]+):\s*"[A-Z0-9_]+"/g, envBlock));
const offered = new Set(all(/\{ id: "([a-z0-9-]+)", label:/g, admin));
const CONFIG_STYLE = new Set(["leonardo"]);   // saved via /api/admin/config, not the key pools

const keyed = [...runtime].filter((p) => !noKey.has(p));

describe("provider lists must not drift", () => {
  it("every keyed provider has a rotating key pool", () => {
    expect(keyed.filter((p) => !pools.has(p))).toEqual([]);
  });

  it("every keyed provider is saveable via /api/admin/keys", () => {
    // Without this, Settings shows the provider and saving returns 400 unknown provider.
    expect(keyed.filter((p) => !saveable.has(p))).toEqual([]);
  });

  it("nothing is offered in Settings that cannot be saved", () => {
    expect([...offered].filter((p) => !saveable.has(p) && !CONFIG_STYLE.has(p))).toEqual([]);
  });

  it("every keyed provider is discoverable in Settings", () => {
    expect(keyed.filter((p) => !offered.has(p))).toEqual([]);
  });

  it("every pooled provider is documented in .env.example", () => {
    const undocumented = [...all(/^\s*([a-z0-9]+):\s*readPool\("[a-z0-9]+",\s*"([A-Z0-9_]+)",\s*"([A-Z0-9_]+)"/gm, keys)];
    const rows = [...keys.matchAll(/^\s*([a-z0-9]+):\s*readPool\("[a-z0-9]+",\s*"([A-Z0-9_]+)",\s*"([A-Z0-9_]+)"/gm)];
    const missing = rows.filter(([, , plural, singular]) => !envExample.includes(plural) && !envExample.includes(singular)).map((m) => m[1]);
    expect(missing, `undocumented: ${missing.join(", ")}`).toEqual([]);
    expect(undocumented.length).toBeGreaterThan(0);   // guard: the regex must actually match rows
  });
});

describe("credential writes stay local-only", () => {
  it("/api/admin/keys and /api/admin/config are loopback-gated", () => {
    // They write API keys and integration tokens (Slack, Discord, Notion, Cloudflare) — a remote
    // token-holder must not be able to redirect SAM's outbound integrations.
    for (const route of ['app.post("/api/admin/keys"', 'app.post("/api/admin/config"']) {
      const at = index.indexOf(route);
      expect(at, `${route} not found`).toBeGreaterThan(-1);
      expect(index.slice(at, at + 700)).toContain("isLoopback(req)");
    }
  });
});
