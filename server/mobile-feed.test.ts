import { describe, it, expect } from "vitest";
import { generateMobileFeed } from "./mobile-feed.ts";
import { mobileGenerateFeedSnapshotTool } from "./tools.ts";

describe("Mobile Live Feed Hub", () => {
  it("generates structured live feed stream for iOS and Android", () => {
    const feed = generateMobileFeed();

    expect(feed.feedVersion).toBe(1);
    expect(feed.activeCards.length).toBeGreaterThanOrEqual(3);
    expect(feed.activeCards.some(c => c.type === "MARKET")).toBe(true);
    expect(feed.activeCards.some(c => c.type === "STUDIO")).toBe(true);
    expect(feed.activeCards.some(c => c.type === "SYSTEM")).toBe(true);
  });

  it("runs mobileGenerateFeedSnapshotTool", async () => {
    const out = await mobileGenerateFeedSnapshotTool();
    expect(out).toContain("Mobile Live Feed Stream Snapshot");
    expect(out).toContain("FlipIt Desk");
    expect(out).toContain("Higgsfield AI Studio");
    expect(out).toContain("Deep Links:");
  });
});
