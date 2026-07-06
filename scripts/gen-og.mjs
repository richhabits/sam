// ─────────────────────────────────────────────────────────────
//  S.A.M. · generate the OG share image (docs/og.png, 1200×630)
//  Renders an HTML card with the LIVE counts (same source as the
//  landing) via playwright-core + your installed Chrome, so link
//  previews on X/WhatsApp/Discord/LinkedIn always match reality.
//  Run: npm run og   (then commit docs/og.png)
// ─────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => { try { return readFileSync(join(ROOT, p), "utf8"); } catch { return ""; } };

// Same live counts as gen-landing.mjs — one source of truth.
const tools = [...read("server/tools.ts").matchAll(/\bname:\s*"([a-z0-9_]+)"/g)].length;
const brains = (read("server/models.ts").match(/id:\s*"[a-z0-9_]+",\s*tier:\s*"free"/g) || []).length;
const agents = (read("server/agents.ts").match(/\{\s*id:\s*"[a-z0-9_]+",\s*name:/g) || []).length;
let skills = 0;
try { skills = readdirSync(join(ROOT, "skills")).filter((d) => existsSync(join(ROOT, "skills", d, "SKILL.md"))).length; } catch {}

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;
    background:
      radial-gradient(900px 500px at 50% -10%, rgba(240,130,78,.16), transparent 62%),
      radial-gradient(700px 400px at 92% 20%, rgba(95,208,138,.06), transparent 60%),
      #100E0C;
    color:#F3EDE4;display:flex;flex-direction:column;justify-content:space-between;padding:64px 72px;letter-spacing:-.01em}
  .eyebrow{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:20px;letter-spacing:.18em;text-transform:uppercase;color:#F0824E;display:flex;align-items:center;gap:14px}
  .dot{width:12px;height:12px;border-radius:50%;background:#5FD08A}
  h1{font-size:76px;line-height:1.04;font-weight:800;letter-spacing:-.03em;margin-top:26px;max-width:20ch}
  h1 .em{color:#F0824E}
  .stats{display:flex;gap:16px}
  .stat{background:#17130F;border:1px solid rgba(240,130,78,.18);border-radius:18px;padding:22px 30px;text-align:center;min-width:190px}
  .stat .n{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:42px;font-weight:700}
  .stat .n .u{color:#F0824E;font-size:30px}
  .stat .l{font-size:18px;color:#9A9187;margin-top:4px}
  .foot{display:flex;justify-content:space-between;align-items:center}
  .logo{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-weight:700;font-size:28px;letter-spacing:.14em}
  .logo .d{color:#F0824E}
  .url{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:20px;color:#9A9187}
</style></head><body>
  <div>
    <div style="display:flex;align-items:center;gap:20px;margin-bottom:14px">
      <svg viewBox="0 0 192 192" width="72" height="72" style="border-radius:17px">
        <defs><linearGradient id="og-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F0824E"/><stop offset="1" stop-color="#D9531F"/></linearGradient></defs>
        <rect width="192" height="192" rx="44" fill="url(#og-g)"/>
        <rect x="93" y="30" width="6" height="20" rx="3" fill="#FDF6EF"/><circle cx="96" cy="28" r="7" fill="#FDF6EF"/>
        <rect x="48" y="56" width="96" height="84" rx="26" fill="#FDF6EF"/>
        <circle cx="76" cy="94" r="11" fill="#E8673A"/><circle cx="116" cy="94" r="11" fill="#E8673A"/>
        <rect x="78" y="118" width="36" height="7" rx="3.5" fill="#E8673A" opacity="0.55"/>
        <rect x="40" y="86" width="8" height="24" rx="4" fill="#FDF6EF"/><rect x="144" y="86" width="8" height="24" rx="4" fill="#FDF6EF"/>
      </svg>
      <div class="eyebrow" style="margin:0">Free · Private · Mac · Windows · Linux</div>
    </div>
    <h1 style="margin-top:8px">Your own AI. It doesn't just answer — <span class="em">it handles it.</span></h1>
  </div>
  <div class="stats">
    <div class="stat"><div class="n">${tools}</div><div class="l">real tools</div></div>
    <div class="stat"><div class="n">${agents}</div><div class="l">AI agents</div></div>
    <div class="stat"><div class="n">${brains}<span class="u">+</span></div><div class="l">free AI brains</div></div>
    <div class="stat"><div class="n"><span class="u">£</span>0</div><div class="l">per month</div></div>
  </div>
  <div class="foot">
    <span class="logo">S<span class="d">.</span>A<span class="d">.</span>M</span>
    <span class="url">github.com/richhabits/sam</span>
  </div>
</body></html>`;

const tmp = join(ROOT, "docs", ".og-tmp.html");
writeFileSync(tmp, html);

// playwright-core ships no browser — use the machine's installed Chrome/Edge.
let browser;
for (const channel of ["chrome", "msedge", "chromium"]) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* try next */ }
}
if (!browser) { console.error("  og: no Chrome/Edge found — skipped (install Chrome and run `npm run og`)"); process.exit(0); }

const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
await page.goto("file://" + tmp);
await page.screenshot({ path: join(ROOT, "docs", "og.png") });
await browser.close();
try { const { unlinkSync } = await import("node:fs"); unlinkSync(tmp); } catch {}
console.log(`  og.png regenerated · ${tools} tools · ${agents} agents · ${brains}+ brains (1200×630 @2x)`);
