import { describe, it, expect, beforeEach } from "vitest";
import { holdPending, takePending, withPending, _pendingSize, _clearPending } from "./pending.ts";

const ctx = { tier: "free", projectId: "p1", skillBody: "", skillId: "ops", user: { name: "Alex" } };
const action = { tool: "run_command", input: { command: "ls" }, transcript: "secret transcript", trace: ["step"] };

describe("pending approval store", () => {
  beforeEach(() => _clearPending());

  it("holds an action and returns an opaque id", () => {
    const id = holdPending({ ...action, ...ctx });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(10);
    expect(_pendingSize()).toBe(1);
  });

  it("takePending is one-shot — the id can't be replayed", () => {
    const id = holdPending({ ...action, ...ctx });
    const first = takePending(id);
    expect(first?.tool).toBe("run_command");
    expect(first?.transcript).toBe("secret transcript");   // server keeps the transcript
    expect(takePending(id)).toBeUndefined();               // second use is gone
    expect(_pendingSize()).toBe(0);
  });

  it("returns undefined for an unknown or missing id (no forged approvals)", () => {
    expect(takePending("not-a-real-id")).toBeUndefined();
    expect(takePending(undefined)).toBeUndefined();
  });

  it("withPending parks a pending result and strips the transcript from the client payload", () => {
    const wrapped = withPending({ kind: "pending", ...action } as any, ctx);
    expect(wrapped.pendingId).toBeTruthy();
    expect(wrapped.transcript).toBe("");                   // transcript never leaves the server
    const held = takePending(wrapped.pendingId!);
    expect(held?.transcript).toBe("secret transcript");    // ...but the server still has it
    expect(held?.tool).toBe("run_command");
  });

  it("withPending passes non-pending results straight through untouched", () => {
    const finalR = { kind: "final", text: "done", trace: [] };
    const out = withPending(finalR as any, ctx);
    expect(out).toEqual(finalR);
    expect(_pendingSize()).toBe(0);
  });

  it("expires actions older than the TTL", () => {
    const old = holdPending({ ...action, ...ctx }, 0);        // stamped at epoch
    expect(_pendingSize()).toBe(1);
    holdPending({ ...action, ...ctx }, 20 * 60_000);          // 20 min later → sweep drops the stale one
    expect(takePending(old)).toBeUndefined();
  });
});
