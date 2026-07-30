import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// B4's promise: a lock screen is glanced at by anyone nearby, not just the operator, so
// nothing credential-shaped or otherwise sensitive should reach it. web-push itself is
// mocked — these tests are about what SAM decides to SEND, never about whether a real
// push provider accepted it.
const sent: { payload: any }[] = [];
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }),
    setVapidDetails: () => { /* no-op in tests */ },
    sendNotification: async (_sub: any, payload: string) => { sent.push({ payload: JSON.parse(payload) }); },
  },
}));

let dir: string;
let P: typeof import("./push.ts");

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-push-"));
  process.env.VAULT_DIR = dir;
  sent.length = 0;
  vi.resetModules();
  P = await import("./push.ts");
});
afterEach(() => { delete process.env.VAULT_DIR; rmSync(dir, { recursive: true, force: true }); });

describe("summarize — what's safe to put on a lock screen", () => {
  it("strips credential-shaped content via the same scrubber the logs use", () => {
    const out = P.summarize("here is a key sk-ant-abcdefghijklmnopqrstuvwx and more");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(out).toContain("[redacted]");
  });

  it("collapses home directory paths, same as an error message would", () => {
    const out = P.summarize("saved to /Users/alex/sam/vault/keys.json");
    expect(out).toContain("~");
    expect(out).not.toContain("alex");
  });

  it("truncates to the requested length, default 100", () => {
    expect(P.summarize("x".repeat(500)).length).toBeLessThanOrEqual(100);
    expect(P.summarize("x".repeat(500), 20).length).toBeLessThanOrEqual(20);
  });

  it("handles empty/missing input without throwing", () => {
    expect(P.summarize("")).toBe("");
    expect(P.summarize(undefined as any)).toBe("");
  });
});

describe("pushNotify — the actual sent payload is scrubbed, not just summarize()", () => {
  it("redacts a credential-shaped string even if a caller forgot to summarize it first", async () => {
    P.addSubscription({ endpoint: "https://example.com/ep1", keys: { p256dh: "a", auth: "b" } });
    await P.pushNotify("title", "leaking sk-ant-abcdefghijklmnopqrstuvwx here");
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.body).not.toContain("abcdefghijklmnopqrstuvwx");
    expect(sent[0].payload.body).toContain("[redacted]");
  });

  it("still strips markdown formatting and caps length, as before", async () => {
    P.addSubscription({ endpoint: "https://example.com/ep2", keys: { p256dh: "a", auth: "b" } });
    await P.pushNotify("title", `${"#".repeat(5)} heading **bold** \`code\` > quote ${"y".repeat(300)}`);
    expect(sent[0].payload.body).not.toMatch(/[#*`>]/);
    expect(sent[0].payload.body.length).toBeLessThanOrEqual(220);
  });

  it("does nothing, sends nothing, with no subscribers", async () => {
    await P.pushNotify("title", "body");
    expect(sent).toHaveLength(0);
  });

  it("carries the title and url through unscrubbed — only the body is content-risky", async () => {
    P.addSubscription({ endpoint: "https://example.com/ep3", keys: { p256dh: "a", auth: "b" } });
    await P.pushNotify("SAM — scheduled task", "hello", "/?ask=abc123");
    expect(sent[0].payload.title).toBe("SAM — scheduled task");
    expect(sent[0].payload.url).toBe("/?ask=abc123");
  });
});
