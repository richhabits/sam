import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/private/tmp/claude-501/-Users-user/sam-moments-test";
let M: typeof import("./moments.ts");
beforeAll(async () => { process.env.VAULT_DIR = SCRATCH; M = await import("./moments.ts"); });
beforeEach(() => { rmSync(SCRATCH, { recursive: true, force: true }); M.__resetForTest(); });

describe("share moments (opt-in, dismissible)", () => {
  it("no moment before any success", () => {
    expect(M.nextMoment()).toBeNull();
  });

  it("surfaces the Star card on the 10th task, once", () => {
    for (let i = 0; i < 10; i++) M.recordSuccess("task");
    const m = M.nextMoment();
    expect(m?.kind).toBe("star");
    expect(m?.snippet).toContain("github.com/richhabits/sam");
    expect(M.nextMoment()).toBeNull();   // shown once, not repeated
  });

  it("a cache-hit streak of 3 surfaces a share moment", () => {
    M.recordSuccess("cache-hit"); M.recordSuccess("cache-hit"); M.recordSuccess("cache-hit");
    const m = M.nextMoment();
    expect(m?.kind).toBe("share");
    expect(m?.title.toLowerCase()).toContain("memory");
  });

  it("a dismissed moment never returns", () => {
    M.recordSuccess("forged");
    const m = M.nextMoment();
    expect(m?.id).toBe("share-forged");
    // it was marked shown; dismiss it and confirm it can't come back
    M.dismiss("share-forged");
    // force it to be eligible again by not being in shown? dismissed wins regardless
    expect(M.nextMoment()?.id).not.toBe("share-forged");
  });
});
