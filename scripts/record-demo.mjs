#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  SAM demo recorder — regenerates the README/landing hero media each release so it never goes stale.
//  Drives a real SAM session in a headless browser, records it, and writes docs/media/demo.gif (+ .mp4).
//
//  Deps (dev-only, not shipped): playwright + ffmpeg.
//    npm i -D playwright && npx playwright install chromium
//    brew install ffmpeg   (or apt-get install ffmpeg)
//  Run:  node scripts/record-demo.mjs        (boots SAM on :8787 if it isn't already up)
// ─────────────────────────────────────────────────────────────
import { spawn, execSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/media");
const URL = process.env.SAM_URL || "http://127.0.0.1:8787";
const SCRIPT = [                        // the scripted session — a real prompt that fires a real tool
  "what's the weather today and directions to the nearest coffee?",
];

function have(cmd) { try { execSync(`command -v ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } }
async function up(url) { try { const r = await fetch(url + "/api/health", { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }

async function main() {
  mkdirSync(outDir, { recursive: true });
  if (!have("ffmpeg")) { console.error("✗ ffmpeg not found — install it (brew install ffmpeg). Skipping."); process.exit(1); }
  let pw;
  try { pw = await import("playwright"); } catch { console.error("✗ playwright not installed — `npm i -D playwright && npx playwright install chromium`. Skipping."); process.exit(1); }

  // Boot SAM if it isn't already serving.
  let server;
  if (!(await up(URL))) {
    console.log("▸ booting SAM…");
    server = spawn("node", ["dist/server.mjs"], { cwd: root, stdio: "ignore", detached: true });
    for (let i = 0; i < 30 && !(await up(URL)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await up(URL))) { console.error("✗ SAM didn't boot"); process.exit(1); }
  }

  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  console.log("▸ recording…");
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Handle onboarding if it appears.
  const nameInput = page.locator('input[placeholder="Your name"]');
  if (await nameInput.count()) { await nameInput.fill("Alex"); await page.getByText("Let's go").click().catch(() => {}); await page.waitForTimeout(1200); }

  for (const line of SCRIPT) {
    const box = page.locator("textarea, input[type=text]").last();
    await box.click();
    for (const ch of line) { await box.type(ch, { delay: 28 }); }   // human-paced typing reads well on GIF
    await box.press("Enter");
    await page.waitForTimeout(9000);   // let the answer stream + a tool fire
  }
  await page.waitForTimeout(1200);
  await ctx.close();   // flushes the video
  await browser.close();
  if (server) process.kill(-server.pid);

  // playwright writes a random-named .webm — grab the newest, transcode to mp4 + gif.
  const webm = readdirSync(outDir).filter((f) => f.endsWith(".webm")).map((f) => join(outDir, f)).sort().pop();
  if (!webm) { console.error("✗ no recording produced"); process.exit(1); }
  const mp4 = join(outDir, "demo.mp4"), gif = join(outDir, "demo.gif");
  renameSync(webm, join(outDir, "_raw.webm"));
  execSync(`ffmpeg -y -i "${join(outDir, "_raw.webm")}" -movflags +faststart -pix_fmt yuv420p "${mp4}"`, { stdio: "ignore" });
  // GIF: 12fps, 960px wide, palette for crisp color + small size.
  execSync(`ffmpeg -y -i "${mp4}" -vf "fps=12,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${gif}"`, { stdio: "ignore" });
  console.log(`✓ wrote ${gif} + ${mp4}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
