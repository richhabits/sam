/**
 * Studio style-card parity — static, across the src/server boundary.
 *
 * The HUD renders one card per entry in StudioView's STYLES and paints it with
 * `background-image: url(/api/studio/preview/<id>)`. That route only knows the ids in
 * STUDIO_PREVIEWS (server/routes.studio.ts) and 404s on anything else — and a 404 on a CSS
 * background is INVISIBLE: the card just renders as an empty rectangle with a label. Four styles
 * (lineart, vapor, clay, blueprint) shipped exactly that way.
 *
 * The two lists can't import each other (one is JSX in the Vite bundle, one is server-side), so
 * this reads both sources. Weaker than a live request, but it catches the only way they drift:
 * someone adds a style card and forgets the preview prompt.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const studioView = readFileSync(join(here, "..", "src", "StudioView.tsx"), "utf8");
const routes = readFileSync(join(here, "routes.studio.ts"), "utf8");

/** ids from the STYLES array literal only — MOTIONS/RATIOS live further down the same file. */
function styleIds(): string[] {
  const block = studioView.match(/const STYLES = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error("could not find STYLES in src/StudioView.tsx — update this test");
  return [...block[1].matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]);
}

/** keys from the STUDIO_PREVIEWS object literal. */
function previewIds(): string[] {
  const block = routes.match(/const STUDIO_PREVIEWS: Record<string, string> = \{([\s\S]*?)\n {2}\};/);
  if (!block) throw new Error("could not find STUDIO_PREVIEWS in server/routes.studio.ts — update this test");
  return [...block[1].matchAll(/^\s*"?([\w-]+)"?:\s*"/gm)].map((m) => m[1]);
}

describe("studio style previews", () => {
  it("finds both lists (guard: this test is worthless if either parse breaks)", () => {
    expect(styleIds().length).toBeGreaterThan(10);
    expect(previewIds().length).toBeGreaterThan(10);
    expect(styleIds()).toContain("cinematic");
    expect(previewIds()).toContain("cinematic");
  });

  it("every style card has a server-side preview prompt", () => {
    const previews = new Set(previewIds());
    const blank = styleIds().filter((id) => !previews.has(id));
    expect(blank, "these style cards would render blank — add them to STUDIO_PREVIEWS").toEqual([]);
  });

  it("no preview prompt exists for a style nobody shows", () => {
    const styles = new Set(styleIds());
    expect(previewIds().filter((id) => !styles.has(id))).toEqual([]);
  });
});
