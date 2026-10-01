import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Audit finding: POST /api/push/subscribe stored the request body verbatim. Any paired device could
// register an http:// (or loopback/LAN) endpoint that SAM then POSTs to on every notification,
// stuff the file with megabytes of extra fields, or add subscriptions without limit.
vi.mock("web-push", () => ({
  default: { generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }), setVapidDetails: () => undefined, sendNotification: async () => undefined },
}));

let dir: string;
let P: typeof import("./push.ts");
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-pushsub-"));
  process.env.VAULT_DIR = dir;
  vi.resetModules();
  P = await import("./push.ts");
});
afterEach(() => { delete process.env.VAULT_DIR; rmSync(dir, { recursive: true, force: true }); });

const web = (endpoint: string, extra: object = {}) => ({ endpoint, keys: { p256dh: "p", auth: "a" }, ...extra }) as any;

describe("addSubscription — bounds and validation", () => {
  it("accepts a normal https web-push subscription", () => {
    expect(P.addSubscription(web("https://fcm.googleapis.com/fcm/send/abc"))).toBe(true);
    expect(P.subscriberCount()).toBe(1);
  });

  it("refuses non-https endpoints (SAM must not POST to http / local services on a caller's say-so)", () => {
    expect(P.addSubscription(web("http://127.0.0.1:8787/api/restart"))).toBe(false);
    expect(P.addSubscription(web("not a url"))).toBe(false);
    expect(P.subscriberCount()).toBe(0);
  });

  it("refuses oversized fields", () => {
    expect(P.addSubscription(web("https://example.com/" + "a".repeat(5000)))).toBe(false);
    expect(P.addSubscription({ expoPushToken: "x".repeat(5000) })).toBe(false);
  });

  it("stores only the fields web-push needs, not the whole body", () => {
    P.addSubscription(web("https://example.com/ep", { junk: "z".repeat(100_000) }));
    const file = readFileSync(join(dir, "push-subs.json"), "utf8");
    expect(file).not.toContain("junk");
    expect(file.length).toBeLessThan(500);
  });

  it("caps the number of subscribers", () => {
    for (let i = 0; i < 80; i++) P.addSubscription(web(`https://example.com/ep${i}`));
    expect(P.subscriberCount()).toBe(50);
  });
});
