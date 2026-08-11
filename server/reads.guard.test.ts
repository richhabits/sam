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
