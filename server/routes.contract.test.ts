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
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// Scans index.ts AND every routes.*.ts module. index.ts is being split by domain (audit #2), and
// a contract test that only read index.ts would silently stop covering each route as it moved —
// shrinking its own scope with every extraction while still reporting green.
const here = dirname(fileURLToPath(import.meta.url));
const routeFiles = ["index.ts", ...readdirSync(here).filter((f) => /^routes\..*\.ts$/.test(f) && !f.includes(".test."))];
const sources = routeFiles.map((f) => ({ file: f, text: readFileSync(join(here, f), "utf8") }));
const src = sources.map((s) => s.text).join("\n");

type Route = { method: string; path: string; body: string; file: string };
// Parsed PER FILE, never across the concatenation. Slicing the joined text made each file's last
// route absorb the head of the next file — 5 routes did. That misfires in both directions: it
// flagged the catch-all GET * as "privileged" because routes.admin.ts's `import { setElonMode }`
// bled into its body, and — the dangerous direction — a route could have absorbed a NEIGHBOURING
// file's `isLoopback(req)` and passed the gate check without being gated at all.
const routes: Route[] = sources.flatMap(({ file, text }) => {
  const hits = [...text.matchAll(/app\.(get|post|delete|put|patch|all)\("([^"]+)"/g)];
  return hits.map((m, i) => ({
    file,
    method: m[1].toUpperCase(),
    path: m[2],
    // Import lines are stripped: PRIVILEGED matches substrings, so `import { setElonMode }`
    // reads as the privileged call `setElon...`. Only the handler body should be searched.
    body: text
      .slice(m.index!, i + 1 < hits.length ? hits[i + 1].index! : text.length)
      .replace(/^\s*import .*$/gm, ""),
  }));
});

/** Writes that change credentials, or what SAM is allowed to do without asking. */
const PRIVILEGED = ["writeEnv(", "setAllow", "regenerateToken", "setAutopilot", "setElon", "revokeToken", "issueToken"];

describe("route contract", () => {
  it("finds the routes (guard: this test is worthless if the parse breaks)", () => {
    expect(routeFiles.length).toBeGreaterThan(1);          // index.ts + at least one extracted module
    expect(routes.length).toBeGreaterThan(100);
    expect(routes.some((r) => r.path === "/api/memory")).toBe(true);   // an EXTRACTED route
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
      .map((r) => `${r.method} ${r.path} (${r.file})`);
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
