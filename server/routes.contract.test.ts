/**
 * Route contract — static, over server/index.ts.
 *
 * index.ts calls app.listen() at module scope with no export, so importing it in a test would
 * boot a real server (port conflicts, vault writes). These assertions therefore read the source.
 * That is weaker than driving live requests, and it is deliberately scoped to the invariants
 * that DON'T need a running server — the ones that actually broke today:
 *
 *   · a privileged write shipped without its loopback gate  (/api/admin/keys, /api/admin/config)
 *   · an error response the UI couldn't recognise            (the 400 Settings ignored)
 *   · a route silently shadowed by a duplicate registration
 *
 * If someone later exports `app` from index.ts, replace this with supertest and drive the real
 * handlers — strictly better. Until then this holds the line at zero cost.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

type Route = { method: string; path: string; body: string };
const routes: Route[] = (() => {
  const hits = [...src.matchAll(/app\.(get|post|delete|put|patch)\("([^"]+)"/g)];
  return hits.map((m, i) => ({
    method: m[1].toUpperCase(),
    path: m[2],
    body: src.slice(m.index!, i + 1 < hits.length ? hits[i + 1].index! : src.length),
  }));
})();

/** Writes that change credentials, or what SAM is allowed to do without asking. */
const PRIVILEGED = ["writeEnv(", "setAllow", "regenerateToken", "setAutopilot", "setElon", "revokeToken", "issueToken"];

describe("route contract", () => {
  it("finds the routes (guard: this test is worthless if the parse breaks)", () => {
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((r) => r.path === "/api/admin/keys")).toBe(true);
  });

  it("no route is registered twice", () => {
    // Express silently keeps the FIRST match, so a duplicate makes the second handler dead code
    // that looks live. Nothing in a diff shows it.
    const seen = new Map<string, number>();
    for (const r of routes) seen.set(`${r.method} ${r.path}`, (seen.get(`${r.method} ${r.path}`) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  it("every privileged write is loopback-gated", () => {
    // THE ONE THAT MATTERS. /api/admin/keys and /api/admin/config shipped without this: with
    // remote enabled, a token-holder could write API keys and repoint the Slack token, Discord
    // webhook and Cloudflare key at their own endpoints.
    const ungated = routes
      .filter((r) => PRIVILEGED.some((k) => r.body.includes(k)))
      .filter((r) => !r.body.includes("isLoopback(req)"))
      .map((r) => `${r.method} ${r.path}`);
    expect(ungated, `privileged but not loopback-only: ${ungated.join(", ")}`).toEqual([]);
  });

  it("every error response uses a shape the client can recognise", () => {
    // Two documented envelopes, and only two:
    //   { error: "..." }            — the API convention (81 of 83 responses)
    //   { kind: "final", text: "" } — the CHAT protocol, so a mid-stream failure renders as a
    //                                 friendly message instead of a raw error. Deliberate.
    const bad: string[] = [];
    for (const m of src.matchAll(/res\.status\((\d{3})\)\.json\(\{([^}]*)\}/g)) {
      const [status, payload] = [m[1], m[2]];
      if (Number(status) < 400) continue;
      if (/\berror\s*:/.test(payload)) continue;
      if (/\bkind\s*:\s*"final"/.test(payload)) continue;
      bad.push(`${status}: {${payload.trim().slice(0, 60)}}`);
    }
    expect(bad, "error responses the UI cannot parse").toEqual([]);
  });

  it("every route lives under /api (except the SPA catch-all)", () => {
    const stray = routes.filter((r) => !r.path.startsWith("/api/") && r.path !== "*").map((r) => `${r.method} ${r.path}`);
    expect(stray).toEqual([]);
  });

  it("mutating routes are POST/DELETE/PUT, never GET", () => {
    // A GET that mutates is reachable by a link, a prefetch, or a crawler.
    const mutatingGets = routes
      .filter((r) => r.method === "GET")
      .filter((r) => PRIVILEGED.some((k) => r.body.includes(k)))
      .map((r) => r.path);
    expect(mutatingGets, "GET routes that write privileged state").toEqual([]);
  });
});
