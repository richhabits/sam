import { describe, expect, it } from "vitest";
import { streamPolicy } from "./stream-policy.ts";

describe("streamPolicy", () => {
  it("normal chat keeps everything on", () => {
    expect(streamPolicy({})).toEqual({ turbo: false, routines: true, learn: true, cache: true });
  });

  it("turbo is one fast call but otherwise normal", () => {
    expect(streamPolicy({ tier: "turbo" })).toEqual({ turbo: true, routines: true, learn: true, cache: true });
  });

  it("untrusted content gets no tools, no routines, no memory, no cache", () => {
    expect(streamPolicy({ untrusted: true })).toEqual({ turbo: true, routines: false, learn: false, cache: false });
    expect(streamPolicy({ untrusted: true, tier: "free" }).turbo).toBe(true);
  });

  it("only a real boolean true counts — no truthy strings", () => {
    expect(streamPolicy({ untrusted: "true" }).routines).toBe(true);
    expect(streamPolicy({ untrusted: 1 }).learn).toBe(true);
    expect(streamPolicy(null).turbo).toBe(false);
  });
});
