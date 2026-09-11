import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let ios: typeof import("./ios.ts");

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sam-drop-"));
  process.env.SAM_DROP_FOLDER = dir;
  vi.resetModules();
  ios = await import("./ios.ts");
});
afterEach(() => {
  delete process.env.SAM_DROP_FOLDER;
  rmSync(dir, { recursive: true, force: true });
});

describe("iCloud drop (Watch / iPhone shortcut)", () => {
  it("writes SAM_Last_Reply.txt into the drop folder for Get File on the Watch", () => {
    const dest = ios.writeLastReply("120");
    expect(dest).toBe(join(dir, ios.LAST_REPLY_FILE));
    expect(readFileSync(dest, "utf8")).toBe("120");
  });

  it("does not delete SAM_Last_Reply.txt when scanning drops", async () => {
    writeFileSync(join(dir, ios.LAST_REPLY_FILE), "keep me", "utf8");
    writeFileSync(join(dir, "sam-watch.txt"), "15 * 8", "utf8");
    const seen: string[] = [];
    ios.startDropWatcher((d) => { seen.push(d.content); });
    await new Promise((r) => setTimeout(r, 200));
    expect(existsSync(join(dir, ios.LAST_REPLY_FILE))).toBe(true);
    expect(readFileSync(join(dir, ios.LAST_REPLY_FILE), "utf8")).toBe("keep me");
    expect(seen.some((c) => c.includes("15") || c.includes("8") || c === "15 * 8")).toBe(true);
  });
});
