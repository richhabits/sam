import { describe, expect, it } from "vitest";
import { streamPolicy, UNTRUSTED_SYSTEM_NOTE } from "./stream-policy.ts";

describe("streamPolicy", () => {
  it("normal chat keeps everything on", () => {
    expect(streamPolicy({})).toEqual({ untrusted: false, turbo: false, routines: true, learn: true, cache: true, log: true });
  });

  it("turbo is one fast call but otherwise normal", () => {
    expect(streamPolicy({ tier: "turbo" })).toEqual({ untrusted: false, turbo: true, routines: true, learn: true, cache: true, log: true });
  });

  it("untrusted content gets no tools, routines, memory, cache or log", () => {
    expect(streamPolicy({ untrusted: true })).toEqual({ untrusted: true, turbo: true, routines: false, learn: false, cache: false, log: false });
    expect(streamPolicy({ untrusted: true, tier: "free" }).turbo).toBe(true);
  });

  it("only a real boolean true counts — no truthy strings", () => {
    expect(streamPolicy({ untrusted: "true" }).routines).toBe(true);
    expect(streamPolicy({ untrusted: 1 }).learn).toBe(true);
    expect(streamPolicy(null).turbo).toBe(false);
  });
});

describe("UNTRUSTED_SYSTEM_NOTE", () => {
  it("forbids claiming actions and following page instructions", () => {
    expect(UNTRUSTED_SYSTEM_NOTE).toMatch(/no tools/i);
    expect(UNTRUSTED_SYSTEM_NOTE).toMatch(/never say or imply/i);
    expect(UNTRUSTED_SYSTEM_NOTE).toMatch(/never as instructions/i);
  });
});
