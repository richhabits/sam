import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { passkeyRequiredForMutation } from "./http-guards.ts";

// WHO MAY MINT AN INVITATION.
//
// /api/pair/new and /api/pair/revoke-all shipped saying "(privileged)" in a comment and enforcing
// nothing. They leaned on the global mutation gate — which deliberately steps aside for an
// off-machine caller and defers to the remote-token gate, and THAT gate is registered further down
// the file than these routes, so it never ran for them.
//
// With SAM_REMOTE=1 the result was inverted: loopback got 401 while anyone on the network could
// POST /api/pair/new, receive a valid code, claim it at the open on-ramp, and hold a fully paired
// session — vault, files, the yard. Found by probing the LAN address after enabling remote mode.
//
// These tests pin both halves: the property of the gate that made the comment wrong, and the
// per-route guard that now stands in for it.

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
const req = (method: string, path: string, ip = "127.0.0.1") => ({ method, path, socket: { remoteAddress: ip } });

describe("why the global gate was not enough", () => {
  it("steps aside for an off-machine caller — the exact hole", () => {
    const REMOTE_ON = { enforced: true, remote: true };
    // On this machine the gate bites...
    expect(passkeyRequiredForMutation(req("POST", "/api/pair/new"), REMOTE_ON)).toBe(true);
    // ...and for a phone it hands off, expecting a gate that is registered BELOW these routes.
    expect(passkeyRequiredForMutation(req("POST", "/api/pair/new", "192.168.1.50"), REMOTE_ON)).toBe(false);
    expect(passkeyRequiredForMutation(req("POST", "/api/pair/revoke-all", "192.168.1.50"), REMOTE_ON)).toBe(false);
  });

  it("the claim on-ramp is open BY DESIGN — which is why minting must not be", () => {
    // An unpaired device has to be able to redeem a code it was given; that is the whole entry
    // path. It is only safe while the code itself is hard to come by.
    expect(passkeyRequiredForMutation(req("POST", "/api/pair/claim"), { enforced: true, remote: false })).toBe(false);
  });
});

// The handlers are read from source rather than exercised, matching connectors.guard.test.ts: the
// server cannot be booted in a unit test, and what must never regress is the presence of the check.
// Sliced to the NEXT route registration rather than a fixed byte count: a fixed window silently
// depends on how much comment sits above the check, and this test already failed once for exactly
// that reason — a real guard, reported missing, because the prose explaining it was too long.
const handler = (path: string): string => {
  const at = src.indexOf(`app.post("${path}"`);
  if (at === -1) throw new Error(`no route registered for ${path}`);
  const next = src.indexOf("\napp.", at + 1);
  return src.slice(at, next === -1 ? src.length : next);
};

describe("minting and revoking are loopback-and-passkey only", () => {
  it("a pairing code cannot be minted by a remote caller", () => {
    expect(handler("/api/pair/new")).toContain("isTrustedLocal(req)");
  });

  it("sessions cannot be revoked by a remote caller — an unguarded revoke is a one-request DoS", () => {
    expect(handler("/api/pair/revoke-all")).toContain("isTrustedLocal(req)");
  });

  it("revoke-all actually looks at the request it is meant to check", () => {
    // It took `_req` before: a handler that never reads the request cannot possibly authorise it,
    // and the underscore made that look deliberate rather than missing.
    expect(handler("/api/pair/revoke-all")).not.toContain("(_req, res)");
  });

  it("a paired phone is NOT enough — inviting devices is a power above being invited", () => {
    // isPairedSession would let any paired device mint invitations for further devices.
    expect(handler("/api/pair/new")).not.toContain("isPairedSession");
  });
});

describe("handing back your own pairing", () => {
  // The phone's "Forget this device" deleted its own keychain token and left the session alive
  // on the Mac for its full 30 days — a destructive-looking control that destroyed nothing on
  // the machine that actually holds the access. This route is the missing half.
  it("is refused to anyone not already paired", () => {
    expect(handler("/api/pair/forget")).toContain("isPairedSession(req)");
  });

  it("takes no device id — it can only ever revoke the caller", () => {
    // The id is derived from the caller's own token server-side. If this route ever learns to
    // read one off the request, it becomes revoke-anyone reachable from any paired device.
    expect(handler("/api/pair/forget")).toContain("sessionIdFromToken");
    expect(handler("/api/pair/forget")).not.toContain("req.params");
    expect(handler("/api/pair/forget")).not.toContain("req.body");
  });

  it("does not report success when nothing was revoked", () => {
    // The exact failure it exists to end must not reappear inside it: a 200 for a forget that
    // forgot nothing would be indistinguishable from the bug, and worse for being deliberate.
    const h = handler("/api/pair/forget");
    expect(h).toContain("if (!ok)");
    expect(h).toContain("500");
  });
});

describe("no future pairing mutation may ship unguarded", () => {
  it("every POST /api/pair/* except the claim on-ramp checks who is asking", () => {
    const routes = [...src.matchAll(/app\.post\("(\/api\/pair\/[^"]*)"/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(2);   // the list is really being found
    const unguarded = routes.filter((r) => {
      if (r === "/api/pair/claim") return false;                 // the open door, by design
      const body = handler(r);
      return !/isTrustedLocal\(req\)|isPairedSession\(req\)/.test(body);
    });
    expect(unguarded, `unguarded pairing mutations: ${unguarded.join(", ")}`).toEqual([]);
  });
});
