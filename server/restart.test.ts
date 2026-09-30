import { describe, expect, it } from "vitest";
import { isSupervised, restartRefusal } from "./restart.ts";

describe("restartRefusal", () => {
  it("refuses anyone but this machine", () => {
    expect(restartRefusal({ trustedLocal: false, supervised: true })?.status).toBe(403);
  });
  it("refuses when nothing would start SAM again (desktop app)", () => {
    expect(restartRefusal({ trustedLocal: true, supervised: false })?.status).toBe(409);
  });
  it("allows a trusted local caller under the supervisor", () => {
    expect(restartRefusal({ trustedLocal: true, supervised: true })).toBeNull();
  });
});

describe("isSupervised", () => {
  it("is exactly SAM_SUPERVISED=1", () => {
    expect(isSupervised({ SAM_SUPERVISED: "1" })).toBe(true);
    expect(isSupervised({ SAM_SUPERVISED: "true" })).toBe(false);
    expect(isSupervised({})).toBe(false);
  });
});
