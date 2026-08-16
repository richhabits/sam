import { describe, it, expect } from "vitest";
import { unwrapPath } from "./tools.ts";

describe("unwrapPath", () => {
  it("passes through a normal string unchanged (trimmed)", () => {
    expect(unwrapPath("~/Downloads")).toBe("~/Downloads");
    expect(unwrapPath("  /tmp/foo  ")).toBe("/tmp/foo");
  });

  it("falls back to ~ for empty/falsy input", () => {
    expect(unwrapPath("")).toBe("~");
    expect(unwrapPath(null)).toBe("~");
    expect(unwrapPath(undefined)).toBe("~");
  });

  it("recovers from the literal string \"[object Object]\" instead of trying to resolve it as a path", () => {
    expect(unwrapPath("[object Object]")).toBe("~");
  });

  it("unwraps a single-level { path } object — the shape tool-call args actually arrive in", () => {
    expect(unwrapPath({ path: "~/Documents" })).toBe("~/Documents");
    expect(unwrapPath({ dir: "/var/log" })).toBe("/var/log");
    expect(unwrapPath({ folder: "~/Desktop" })).toBe("~/Desktop");
  });

  it("unwraps one level of nesting", () => {
    expect(unwrapPath({ path: { path: "~/nested" } })).toBe("~/nested");
  });

  // AUDIT FIX: unwrapPath recurses on { path, dir, file, target, folder, src, name } with no
  // depth limit. A circular reference can't arrive via JSON-parsed tool-call args (JSON has no
  // way to encode a cycle), but safePath()/unwrapPath() are called from other places too, and
  // agent.ts's executeToolBatch/resumeAgent call tool.activity() — which now runs through
  // unwrapPath for every file/dir tool — with no try/catch around it. An uncaught stack overflow
  // there fails the whole batch/turn, not just one tool call. This is the actual bug this fix
  // shipped without a test for.
  it("does not recurse forever on a circular reference", () => {
    const circular: any = {};
    circular.path = circular;
    expect(() => unwrapPath(circular)).not.toThrow();
    expect(unwrapPath(circular)).toBe("~");
  });

  it("does not recurse forever on a pathologically deep (non-circular) nested object", () => {
    let deep: any = "~/bottom";
    for (let i = 0; i < 10_000; i++) deep = { path: deep };
    expect(() => unwrapPath(deep)).not.toThrow();
  });
});
