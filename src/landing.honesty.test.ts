// Public copy must match what is actually live. Source-text: a render test cannot tell a lie from a label.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("public copy is true", () => {
  it("does not say the App Store listing is missing — native 2.0.0 is live", () => {
    expect(read("README.md")).not.toContain("App Store not live yet");
    expect(read("docs/_template.html")).toContain("apps.apple.com/gb/app/sam-smart-artificial-mind/id6798908400");
    expect(read("docs/_template.html")).toContain("testflight.apple.com/join/htr4htvY");
  });

  it("ships a human support page and links it from the landing", () => {
    const support = read("docs/support.html");
    expect(support).toContain("SAM support");
    expect(support).not.toMatch(/romeo\.valentine|icloud\.com|\+44/i);
    expect(read("docs/_template.html")).toContain("./support.html");
    expect(read("mobile/SUBMISSION.md")).toContain("richhabits.github.io/sam/support.html");
  });

  it("does not grind Pollinations at Studio boot", () => {
    expect(read("server/routes.studio.ts")).not.toContain("Pre-warm the previews");
  });
});
