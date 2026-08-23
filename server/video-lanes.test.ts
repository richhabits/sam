import { describe, expect, it } from "vitest";
import { TOOLS } from "./tools.ts";
import { titleCard } from "./render.ts";

describe("Video Generation Pipeline & Free-Credit Lanes", () => {
  const videoTool = TOOLS.find((t) => t.name === "generate_video");

  it("registers generate_video as a safe tool with clear params", () => {
    expect(videoTool).toBeDefined();
    expect(videoTool?.safe).toBe(true);
    expect(videoTool?.params).toContain("prompt");
    expect(videoTool?.activity?.({ prompt: "A robot painting" })).toContain("Filming");
  });

  it("explains how to configure free video keys when none are pooled", async () => {
    if (!videoTool) throw new Error("generate_video tool missing");
    // With zero video keys in the pool, it directs operator to free options
    const res = await videoTool.run({ prompt: "a sunset over mountains" });
    expect(res).toContain("fal.ai");
    expect(res).toContain("Novita");
    expect(res).toContain("SiliconFlow");
    expect(res).toContain("want an image instead?");
  });

  it("renders deterministic HTML title card safely without XSS", () => {
    const html = titleCard({ title: "SAM Studio", subtitle: "Automated Pipeline" });
    expect(html).toContain("SAM Studio");
    expect(html).toContain("Automated Pipeline");
    expect(html.toLowerCase()).toContain("<!doctype html>");
  });
});
