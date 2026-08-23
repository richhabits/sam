import { describe, it, expect, vi } from "vitest";
import { generateMobileFeed } from "./mobile-feed.ts";
import { mobileGenerateFeedSnapshotTool } from "./tools.ts";

vi.mock("./studio-higgsfield.ts", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    generateStoryboardDirector: vi.fn().mockResolvedValue({
      title: "Test",
      narrativeGoal: "Mocked narrative",
      shots: [{ cinematicPrompt: "Mocked shot" }]
    })
  };
});

describe("Mobile Live Feed Hub", () => {
  it("generates structured live feed stream for iOS and Android", async () => {
    const feed = await generateMobileFeed();

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
