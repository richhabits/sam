// Generates docs/_icons.svg — an SVG sprite for the landing page, built FROM src/Icon.tsx.
//
// The landing page has no bundler, so it can't import the React component. Copying the paths by
// hand would guarantee drift: the app and the site would slowly disagree about what a "brain"
// looks like. This reads the single source and emits <symbol>s, so there is one icon vocabulary
// and the page inherits every future fix automatically.
//
// Run: node scripts/build-icon-sprite.mjs   (verified by scripts/icon-sprite.test.ts)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/Icon.tsx"), "utf8");

const body = src.split("const P: Record<IconName, React.ReactNode> = {")[1]?.split("\n};")[0];
if (!body) throw new Error("Could not find the P glyph table in src/Icon.tsx");

const glyphs = [...body.matchAll(/^ {2}([a-z][\w]*): (.+),$/gm)].map(([, name, jsx]) => {
  // JSX → SVG: drop the fragment wrapper and normalise self-closing tags.
  const inner = jsx.trim().replace(/^<>/, "").replace(/<\/>$/, "").replace(/\s*\/>/g, "/>");
  return { name, inner };
});
if (glyphs.length < 40) throw new Error(`Only found ${glyphs.length} glyphs — the parse likely broke`);

const symbols = glyphs
  .map((g) => `<symbol id="i-${g.name}" viewBox="0 0 24 24">${g.inner}</symbol>`)
  .join("\n");

writeFileSync(
  join(root, "docs/_icons.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
<!-- GENERATED from src/Icon.tsx by scripts/build-icon-sprite.mjs — do not edit by hand.
     Stroke/caps are set on the <use> site in the page CSS so a single rule restyles them all. -->
${symbols}
</svg>\n`,
);

console.log(`icon sprite written: ${glyphs.length} glyphs → docs/_icons.svg`);
