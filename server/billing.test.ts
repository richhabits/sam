import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/tmp/sam-billing-test";
let B: typeof import("./billing.ts");
beforeAll(async () => { process.env.VAULT_DIR = SCRATCH; rmSync(SCRATCH, { recursive: true, force: true }); B = await import("./billing.ts"); });
beforeEach(() => rmSync(SCRATCH, { recursive: true, force: true }));
afterEach(() => { delete process.env.SAM_BILLING; });

describe("billing — never gates core (the load-bearing guarantee)", () => {
  it("is OFF by default; everyone is on the free plan", () => {
    delete process.env.SAM_BILLING;
    expect(B.billingEnabled()).toBe(false);
    expect(B.currentPlan()).toBe("free");
  });

  it("coreGated() is false — always, whether billing is on or off, free or paid", () => {
    expect(B.coreGated()).toBe(false);
    process.env.SAM_BILLING = "1";
    B.setEntitlement("cloud", true, "2026-07-11T09:00:00Z");
    expect(B.currentPlan()).toBe("cloud");
    expect(B.coreGated()).toBe(false);        // a PAID user's core isn't gated either — it's just never a thing
  });

  it("optional-extra gates default to the free behaviour when billing is off", () => {
    delete process.env.SAM_BILLING;
    expect(B.hasCloudBoost()).toBe(false);
    expect(B.hasTeamFeatures()).toBe(false);
    expect(B.isSupporter()).toBe(false);
  });

  it("a paid entitlement unlocks ONLY optional extras, and only while billing is on", () => {
    process.env.SAM_BILLING = "1";
    B.setEntitlement("cloud", true, "2026-07-11T09:00:00Z");
    expect(B.hasCloudBoost()).toBe(true);     // optional extra
    expect(B.hasTeamFeatures()).toBe(false);  // cloud ≠ team
    expect(B.coreGated()).toBe(false);        // still never core
    delete process.env.SAM_BILLING;           // flag off ⇒ back to free behaviour regardless of the file
    expect(B.currentPlan()).toBe("free");
    expect(B.hasCloudBoost()).toBe(false);
  });

  it("checkout is honest + inert until wired (no charge, no dark pattern)", () => {
    delete process.env.SAM_BILLING;
    expect(B.checkout("cloud").ok).toBe(false);          // off ⇒ nothing to buy, SAM is free
    process.env.SAM_BILLING = "1";
    const c = B.checkout("cloud");
    expect(c.ok).toBe(true);
    expect(c.url).toBeNull();                            // no real Stripe until the operator wires it
    expect(c.message).toMatch(/never unlocks anything that was already free/i);
    expect(B.checkout("free").ok).toBe(false);           // free isn't purchasable
  });
});
