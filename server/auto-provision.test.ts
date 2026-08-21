import { describe, it, expect } from "vitest";
import { getAutoProvisionStatus, validateAndSaveProviderKey } from "./auto-provision.ts";

describe("GUIDED KEY SETUP & VALIDATOR ASSISTANT", () => {
  it("returns setup status with signup URLs and key patterns", () => {
    const status = getAutoProvisionStatus();
    expect(status.totalSupportedProviders).toBeGreaterThanOrEqual(10);
    expect(status.targets.length).toBeGreaterThanOrEqual(10);

    const groq = status.targets.find((t) => t.id === "groq");
    expect(groq).toBeDefined();
    expect(groq?.url).toContain("console.groq.com");
    expect(groq?.keyPattern).toBeDefined();
  });

  it("rejects invalid key format based on provider pattern", async () => {
    const res = await validateAndSaveProviderKey("groq", "invalid_random_string", { persistToEnv: false });
    expect(res.validFormat).toBe(false);
    expect(res.saved).toBe(false);
    expect(res.message).toContain("Key format mismatch");
  });

  it("accepts and saves valid key matching provider pattern", async () => {
    // Valid Groq key format starts with gsk_
    const validGroqKey = "gsk_1234567890abcdef1234567890abcdef";
    const res = await validateAndSaveProviderKey("groq", validGroqKey, { persistToEnv: false });
    expect(res.validFormat).toBe(true);
    expect(res.saved).toBe(true);
    expect(res.currentPoolSize).toBeGreaterThanOrEqual(1);
  });
});
