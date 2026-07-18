import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The landing page has no bundler, so it carries a COPY of the icons as an inline SVG sprite.
// A copy drifts: fix a glyph in the app and the site keeps the old one forever, and nobody
// notices because both render fine. These tests make drift fail CI instead of ageing quietly.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const iconSrc = readFileSync(join(root, "src/Icon.tsx"), "utf8");
const sprite = readFileSync(join(root, "docs/_icons.svg"), "utf8");
const page = readFileSync(join(root, "docs/index.html"), "utf8");

const appGlyphs = [
  ...(iconSrc.split("const P: Record<IconName, React.ReactNode> = {")[1]?.split("\n};")[0] ?? "")
    .matchAll(/^ {2}([a-z][\w]*): /gm),
].map((m) => m[1]);

describe("landing page icon sprite", () => {
  it("finds the glyphs (guard: worthless if either parse breaks)", () => {
    expect(appGlyphs.length).toBeGreaterThan(40);
    expect(sprite).toContain("<symbol");
  });

  it("has a symbol for every glyph the app defines", () => {
    const missing = appGlyphs.filter((g) => !sprite.includes(`id="i-${g}"`));
    expect(missing, `regenerate: node scripts/build-icon-sprite.mjs — missing ${missing.join(", ")}`).toEqual([]);
  });

  it("every icon the page USES exists in the sprite", () => {
    // A typo'd <use href="#i-brian"> renders as nothing at all — an invisible hole, no error.
    const used = [...page.matchAll(/href="#i-([\w-]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    const broken = [...new Set(used)].filter((u) => !page.includes(`id="i-${u}"`));
    expect(broken, `these would render as empty space: ${broken.join(", ")}`).toEqual([]);
  });

  it("the page ships no emoji doing icon duty", () => {
    const emoji = page.match(/[\u{1F300}-\u{1FAFF}]/gu) ?? [];
    expect(emoji, `emoji left on the landing page: ${[...new Set(emoji)].join(" ")}`).toEqual([]);
  });

  it("stays self-contained — no external icon requests", () => {
    // The sprite is inlined deliberately: one file, works offline, nothing to 404 later.
    expect(page).toContain("<symbol");
    expect(page).not.toMatch(/<use[^>]+href="https?:/);
  });
});

describe("landing page claims", () => {
  // The page advertised 173 tools and 25 skills while the real counts were 183 and 29. It went
  // stale because `npm run stats` synced the README and nothing else — the one public page most
  // people read was never in the loop. Numbers on a public page are a factual claim.
  const stats = JSON.parse(readFileSync(join(root, "docs/stats.json"), "utf8"));

  it("advertises the real tool count", () => {
    const m = page.match(/<div class="n">(\d+)<\/div><div class="l">real tools/);
    expect(m, "tools stat block not found — did the markup change?").toBeTruthy();
    expect(Number(m?.[1])).toBe(stats.tools);
  });

  it("advertises the real skill count", () => {
    for (const m of page.matchAll(/(\d+) skills/g)) expect(Number(m[1])).toBe(stats.skills);
  });

  it("the summary line matches every count", () => {
    const m = page.match(/(\d+) tools · (\d+) agents · (\d+) skills/);
    expect(m, "summary kicker not found").toBeTruthy();
    expect([Number(m?.[1]), Number(m?.[2]), Number(m?.[3])]).toEqual([stats.tools, stats.agents, stats.skills]);
  });
});
