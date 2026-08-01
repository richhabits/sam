import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { passkeyRequiredForMutation } from "./http-guards.ts";

// WHO MAY READ YOUR WORKSPACES.
//
// The GitHub read routes shipped in 4e7f307 with a comment stating "the global middleware already
// requires a passkey or a paired session". It doesn't — the Handshake gate calls
// passkeyRequiredForMutation, which returns FALSE for GET. Curling /api/github/status with no
// credential at all returned the operator's GitHub account, and once the connectors landed the
// same hole reached Slack messages and Notion pages. Any other process on the machine could ask.
//
// These tests pin both halves: the property of the gate that made the comment wrong, and the
// per-route guard that now stands in for it. A new read route added without the guard fails here.

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
const req = (method: string, path: string) => ({ method, path, socket: { remoteAddress: "127.0.0.1" } });
const ENV = { enforced: true, remote: false };

describe("why the global gate was not enough", () => {
  it("the Handshake gate covers mutations ONLY — a GET is never gated by it", () => {
    expect(passkeyRequiredForMutation(req("POST", "/api/connectors"), ENV)).toBe(true);
    // The line the original comment got wrong. Reading is not gated globally, so a route that
    // returns third-party workspace content has to say so itself.
    expect(passkeyRequiredForMutation(req("GET", "/api/connectors"), ENV)).toBe(false);
    expect(passkeyRequiredForMutation(req("GET", "/api/github/status"), ENV)).toBe(false);
  });
});

describe("every workspace read is guarded at the route", () => {
  // Source-scanned rather than mocked: the risk is a NEW route being added without the guard,
  // and only reading the file catches that.
  const routes = [...src.matchAll(/app\.get\("(\/api\/(?:connectors|github)[^"]*)",[^\n]*\n([^\n]*)/g)];

  it("finds the routes at all — a refactor that moves them must fail here, not pass silently", () => {
    const paths = routes.map((m) => m[1]);
    expect(paths).toContain("/api/connectors");
    expect(paths).toContain("/api/connectors/:id/:kind");
    expect(paths).toContain("/api/github/status");
    expect(paths.length).toBeGreaterThanOrEqual(5);
  });

  it("checks canReadWorkspaces on the first line of every one of them", () => {
    const unguarded = routes.filter((m) => !m[2].includes("canReadWorkspaces")).map((m) => m[1]);
    expect(unguarded, `these return workspace data to any local process: ${unguarded.join(", ")}`).toEqual([]);
  });

  it("accepts the desktop passkey OR a paired session, and nothing else", () => {
    // Both doors are needed and neither is optional: Electron carries the passkey, a paired
    // browser carries the cookie, the phone carries the same session token as a Bearer. Dropping
    // either one locks out a real client; adding a third (e.g. plain isLoopback) reopens the hole.
    const fn = src.slice(src.indexOf("function canReadWorkspaces"), src.indexOf("function denyRead"));
    expect(fn).toContain("isTrustedLocal(req)");
    expect(fn).toContain("isPairedSession(req)");
    expect(fn).not.toMatch(/\bisLoopback\(req\)/);
  });
});
