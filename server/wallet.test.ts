import { describe, it, expect, beforeEach } from "vitest";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SCRATCH = "/tmp/sam-wallet-test";

let W: typeof import("./wallet.ts");

beforeEach(async () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.VAULT_DIR = SCRATCH;
  W = await import("./wallet.ts");
});

describe("wallet state", () => {
  it("starts with zero balance and unverified KYC", () => {
    const w = W.getWallet();
    expect(w.balance).toBe(0);
    expect(w.currency).toBe("GBP");
    expect(w.kyc).toBe("unverified");
    expect(w.transactions).toEqual([]);
  });

  it("persists state to disk and reads it back", () => {
    W.requestKYC();
    // Re-read from disk (not from memory)
    const w = W.getWallet();
    expect(w.kyc).toBe("pending");
  });
});

describe("KYC flow", () => {
  it("requestKYC transitions unverified → pending", () => {
    const w = W.requestKYC();
    expect(w.kyc).toBe("pending");
  });

  it("requestKYC on already-pending is a no-op", () => {
    W.requestKYC();
    const w = W.requestKYC();
    expect(w.kyc).toBe("pending");
  });

  it("approveKYC transitions to verified", () => {
    W.requestKYC();
    const w = W.approveKYC();
    expect(w.kyc).toBe("verified");
  });

  it("requestKYC on rejected re-starts the process", () => {
    // The previous version of this test didn't actually reach a rejected state — there's no
    // rejectKYC() in the public API to drive it there, so it silently re-tested the
    // unverified→pending transition under a misleading name. Writing the rejected state
    // directly to the persisted file (which wallet.ts itself reads fresh each call) genuinely
    // exercises the `state.kyc === "rejected"` branch of requestKYC's guard.
    writeFileSync(join(SCRATCH, "wallet.json"), JSON.stringify({
      balance: 0, currency: "GBP", kyc: "rejected", transactions: [],
    }));
    const w = W.requestKYC();
    expect(w.kyc).toBe("pending");
  });
});

describe("deposit — the KYC guard", () => {
  it("blocks deposits without KYC verification", () => {
    const { state, error } = W.deposit(500);
    expect(error).toContain("KYC");
    expect(state.balance).toBe(0);
    expect(state.transactions).toHaveLength(0);
  });

  it("accepts deposits once KYC is verified", () => {
    W.requestKYC();
    W.approveKYC();
    const { state, error } = W.deposit(1000, "GBP");
    expect(error).toBeUndefined();
    expect(state.balance).toBe(1000);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].type).toBe("deposit");
    expect(state.transactions[0].amount).toBe(1000);
    expect(state.transactions[0].status).toBe("completed");
  });

  it("accumulates multiple deposits correctly", () => {
    W.requestKYC();
    W.approveKYC();
    W.deposit(500);
    const { state } = W.deposit(300);
    expect(state.balance).toBe(800);
    expect(state.transactions).toHaveLength(2);
  });

  it("transactions have unique IDs", () => {
    W.requestKYC();
    W.approveKYC();
    W.deposit(100);
    const { state } = W.deposit(200);
    const ids = state.transactions.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
