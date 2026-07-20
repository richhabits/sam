import { describe, expect, it } from "vitest";
import { isNewerVer, sourceUpdateStatus } from "./update-status.ts";

describe("isNewerVer", () => {
  it("compares semver parts", () => {
    expect(isNewerVer("2.3.0", "2.2.0")).toBe(true);
    expect(isNewerVer("2.2.1", "2.2.0")).toBe(true);
    expect(isNewerVer("2.2.0", "2.2.0")).toBe(false);
    expect(isNewerVer("2.1.0", "2.2.0")).toBe(false);
  });
});

describe("sourceUpdateStatus", () => {
  it("reports the human version, never a bare SHA, when up to date", () => {
    const s = sourceUpdateStatus("2.2.0", "abc1234def", "abc1234def");
    expect(s.behind).toBe(false);
    expect(s.current).toBe("2.2.0");   // the popover shows "SAM 2.2.0", not the SHA
    expect(s.latest).toBe("2.2.0");
  });

  it("flags behind by SHA and surfaces the short remote SHA as latest", () => {
    const s = sourceUpdateStatus("2.2.0", "aaaaaaa1111", "bbbbbbb2222");
    expect(s.behind).toBe(true);
    expect(s.current).toBe("2.2.0");           // still tells the user what they're on
    expect(s.latest).toBe("bbbbbbb");          // short remote SHA — no newer version number exists
  });

  it("falls back to the short local SHA only when no version is known", () => {
    const s = sourceUpdateStatus("", "abc1234def", "abc1234def");
    expect(s.current).toBe("abc1234");
  });
});
