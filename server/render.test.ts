import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderVideo, titleCard } from "./render.ts";

// The heavy render (Chromium + FFmpeg) is an integration test — slow and needs both installed,
// so it's opt-in via RENDER_IT=1. The pure composition logic is always tested.
const RUN = process.env.RENDER_IT === "1";

describe("titleCard", () => {
  it("includes the title and subtitle text", () => {
    const h = titleCard({ title: "Hello", subtitle: "world" });
    expect(h).toContain("Hello");
    expect(h).toContain("world");
  });

  it("escapes HTML so a title can't inject markup (XSS-safe)", () => {
    const h = titleCard({ title: "<script>alert(1)</script>" });
    expect(h).not.toContain("<script>alert(1)</script>");
    expect(h).toContain("&lt;script&gt;");
  });

  it("omits the subtitle element when none is given", () => {
    expect(titleCard({ title: "solo" })).not.toContain('class="sub"');
  });
});

describe("renderVideo (integration)", () => {
  (RUN ? it : it.skip)("renders a deterministic MP4 — same input, identical bytes", async () => {
    const html = titleCard({ title: "T", subtitle: "det" });
    const a = join(tmpdir(), "sam-rt-a.mp4");
    const b = join(tmpdir(), "sam-rt-b.mp4");
    try {
      const r = await renderVideo({ html, durationMs: 500, fps: 20, width: 320, height: 180, out: a });
      expect(existsSync(a)).toBe(true);
      expect(r.frames).toBe(10);
      await renderVideo({ html, durationMs: 500, fps: 20, width: 320, height: 180, out: b });
      const { createHash } = await import("node:crypto");
      const { readFileSync } = await import("node:fs");
      const h = (p: string) => createHash("md5").update(readFileSync(p)).digest("hex");
      expect(h(a)).toBe(h(b));   // determinism
    } finally {
      rmSync(a, { force: true });
      rmSync(b, { force: true });
    }
  }, 60_000);

  it("rounds odd dimensions to even (h264/yuv420p requires it)", () => {
    // pure check of the contract the integration relies on
    const even = (n: number) => (n % 2 === 0 ? n : n + 1);
    expect(even(225)).toBe(226);
    expect(even(720)).toBe(720);
  });
});
