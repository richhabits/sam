import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// THE READ SIDE OF THE HANDSHAKE.
//
// passkeyRequiredForMutation() returns false for GET on purpose, so the global gate that makes a
// local process prove itself before it can CHANGE anything lets it read freely. A GET without a
// guard of its own therefore has no guard at all — and that is exactly the caller the Handshake
// exists to stop: another app on this Mac, or a supply-chained dependency, which passes
// isLoopback while knowing no secret.
//
// /api/schedules was the sharpest example. A schedule row carries the operator's command string
// verbatim, so an unguarded read answered "what does this person have their machine do while
// they are not watching" to anything that could open a socket.
//
// Source-read rather than exercised, matching pairing.guard.test.ts: the server cannot be booted
// in a unit test, and what must never regress is the presence of the check.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

const starts = [...src.matchAll(/^app\.(get|post|put|delete|patch)\((["`])([^"`]+)\2/gm)];
const routes = starts.map((m, i) => ({
  method: m[1],
  path: m[3],
  body: src.slice(m.index, starts[i + 1]?.index ?? src.length),
}));
const get = (path: string) => {
  const r = routes.find((x) => x.method === "get" && x.path === path);
  if (!r) throw new Error(`no GET route registered for ${path}`);
  return r.body;
};

// Reads that carry the operator's own content. Each one answered EVERYONE before this test.
const PRIVATE_READS = [
  "/api/schedules",
  "/api/security",
  "/api/swarms",
  "/api/forged",
  "/api/suggestions",
  // Second sweep: configuration rather than content, but each one answers a question an
  // attacker on this machine asks first — how far can SAM act unattended (/allow, /autopilot),
  // what is installed and broken (/doctor), what other machines does it reach (/p2p/peers).
  "/api/allow",
  "/api/autopilot",
  "/api/doctor",
  "/api/billing",
  "/api/p2p/peers",
  // The telemetry preview BUILDS the real payload from live analytics — a panel whose entire
  // purpose is proving nothing leaves the device was handing it to any local caller.
  "/api/telemetry/preview",
  // sessionId is client-chosen, not a server-generated random token, and activePrompt carries
  // the operator's real prompt text verbatim — this shipped with zero guard at all while the
  // POST that creates the session was (correctly) covered by the mutation gate.
  "/api/device/handoff/:id",
];

describe("reads carrying the operator's own content refuse an uncredentialed caller", () => {
  it.each(PRIVATE_READS)("%s checks who is asking", (path) => {
    expect(get(path)).toContain("canReadOwnContent(req)");
  });

  it.each(PRIVATE_READS)("%s actually reads the request it is meant to check", (path) => {
    // `(_req, res)` is how every one of these shipped: a handler that never looks at the request
    // cannot authorise it, and the underscore makes that read as deliberate rather than missing.
    expect(get(path)).not.toContain("(_req, res)");
  });
});

describe("a guarded fact must not ship through an unguarded route", () => {
  // The failure this catches is not a missing guard — it is a guard that IS there, next to a
  // second route handing out the same answer. Two were found this way:
  //   /api/allow refused the standing authorisations while /api/tools shipped `allowed` per tool
  //   /api/vault/stats refused the vault path while /api/status embedded vaultStats() whole
  // Both routes stay open (a catalogue and a status bar render before anyone pairs); the private
  // FIELDS are now conditional on the same guard their dedicated route uses.
  it("/api/tools only includes `allowed` for a credentialed caller", () => {
    const h = get("/api/tools");
    expect(h).toContain("canReadOwnContent(req)");
    expect(h).toMatch(/\?\s*\{\s*allowed:/);      // conditional, not unconditional
  });

  it("/api/status only includes the vault path and black box for a credentialed caller", () => {
    const h = get("/api/status");
    expect(h).toContain("canReadOwnContent(req)");
    for (const field of ["vault: vaultStats()", "issues: issuesSummary()", "pulse: pulseSummary()"]) {
      expect(h).toContain(field);
    }
    // …and all of them behind the same ternary, not sitting in the unconditional object.
    const conditional = h.slice(h.indexOf("...(mine ?"));
    for (const field of ["vault:", "issues:", "pulse:", "memory:", "docs:"]) expect(conditional).toContain(field);
  });
});

describe("the guard itself", () => {
  const guard = src.slice(src.indexOf("function canReadOwnContent"), src.indexOf("function canReadOwnContent") + 240);

  it("accepts the app, a paired device, and a holder of the operator's remote token", () => {
    // The remote clause is load-bearing, not a loophole: req.remoteScope is set ONLY by the
    // remote gate, after a timing-safe comparison against a 256-bit token the operator minted.
    // Dropping it would "close" these routes by locking out the operator's own phone browser,
    // which gains nothing against a local process holding no credential at all.
    expect(guard).toContain("canReadPrivate(req)");
    expect(guard).toContain("remoteScope");
  });

  it("does not loosen canReadPrivate, which guards the shell/file-adjacent panels", () => {
    // canReadOwnContent is a tier BELOW canReadPrivate. If the remote clause ever migrated up
    // into canReadPrivate, every route trusting it would quietly widen at the same moment.
    // Sliced to the closing brace, not to the next function — the prose between them explains
    // the remote clause and would match on the word alone.
    const at = src.indexOf("function canReadPrivate");
    const strict = src.slice(at, src.indexOf("\n}", at));
    expect(strict).not.toContain("remoteScope");
  });
});
