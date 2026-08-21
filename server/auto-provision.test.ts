import { describe, it, expect } from "vitest";
import { getAutoProvisionStatus, executeAutoProvisioning } from "./auto-provision.ts";

describe("1-CLICK AUTO-KEY PROVISIONING & KEY BUTLER ENGINE", () => {
  it("getAutoProvisionStatus returns live status across all supported providers", () => {
    const status = getAutoProvisionStatus();
    expect(status.totalSupportedProviders).toBeGreaterThanOrEqual(10);
    expect(status.targets.length).toBeGreaterThanOrEqual(10);

    const groq = status.targets.find((t) => t.id === "groq");
    expect(groq).toBeDefined();
    expect(groq?.envVar).toBe("GROQ_API_KEYS");
  });

  it("executeAutoProvisioning provisions mock keys and updates pools", async () => {
    const res = await executeAutoProvisioning({
      providers: ["groq", "cerebras"],
      mockKeys: true,
      botEmail: "test_sam_bot@gmail.com",
    });

    expect(res.botEmail).toBe("test_sam_bot@gmail.com");
    expect(res.totalAttempted).toBe(2);
    expect(res.totalSucceeded).toBe(2);
    expect(res.events.length).toBe(2);
    expect(res.events[0].status).toBe("provisioned");
    expect(res.updatedPools.groq).toBeGreaterThanOrEqual(1);
    expect(res.updatedPools.cerebras).toBeGreaterThanOrEqual(1);
  });
});
