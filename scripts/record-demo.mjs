#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  SAM demo recorder — regenerates the README/landing hero media each release so it never goes stale.
//  Drives a real SAM session in a headless browser, records it, and writes docs/media/demo.gif (+ .mp4).
//  The scripted session fires `/team …` so the hero shows SAM's distinctive move: a crew of specialists
//  assembling and working in parallel. A team runs longer than a single answer, so the GIF is longer too
//  — tune SAM_DEMO_WAIT_MS (default 16000) down if docs/media/demo.gif comes out too heavy for the README.
//
//  Deps (dev-only, not shipped): playwright (or the repo's playwright-core) + ffmpeg + a chromium build.
//    npx playwright install chromium        # browser binary (works for playwright-core too)
//    brew install ffmpeg                     # or apt-get install ffmpeg
//  Run:  node scripts/record-demo.mjs        (boots SAM on :8787 if it isn't already up)
//
//  IMPORTANT — record on a machine with a WORKING BRAIN (free-tier keys in .env, or a local Ollama
//  model). The scripted prompt fires real tools; with no brain configured the answer is empty and the
//  GIF is useless. This is why it's not a hosted-CI job — run it where SAM actually answers.
// ─────────────────────────────────────────────────────────────
import { spawn, execSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs/media");
const URL = process.env.SAM_URL || "http://127.0.0.1:8787";
// The scripted session. `/team <request>` assembles a crew that runs in parallel — the UI renders each
// agent going active → done (the distinctive money-shot). The crew is planned by the model from the
// request (server/agents.ts makePlan), so three clean, distinct workstreams steer it toward exactly the
// trio we want on screen: research → Scout 🔬, copy → Quill ✍️, design → Maestro 🎨. It's model-planned,
// not hard-wired, so an occasional take may add/swap one — re-run if the crew composition isn't clean.
// The scripted session — SAM's real edge on screen: it REMEMBERS YOU. Turn 1 tells it about the
// brand; turn 2 asks for work and SAM uses what it just learned, no re-explaining. That "it kept the
// thread and knows my world" beat is the hook ChatGPT/Claude don't give you out of the box.
// Override with SAM_DEMO_SCRIPT (JSON array of strings) for a different scenario.
const SCRIPT = process.env.SAM_DEMO_SCRIPT
  ? JSON.parse(process.env.SAM_DEMO_SCRIPT)
  : [
      // "don't act yet" keeps turn 1 a clean acknowledgement (no tool detours), so the memory beat reads clearly.
      "Just remember this about me for later — don't do anything yet: my brand is Hectic Bullz, I make content for French bulldog owners, and my brand colour is teal.",
      "perfect — now write me a punchy Instagram bio",
    ];
const ANSWER_WAIT_MS = Number(process.env.SAM_DEMO_WAIT_MS || 8000);   // chat replies stream in quickly — no team to assemble, so keep the GIF tight
const FINAL_HOLD_MS = Number(process.env.SAM_DEMO_HOLD_MS || 4000);    // hold on the last answer (the payoff) so it's clearly on screen at the end

function have(cmd) { try { execSync(`command -v ${cmd}`, { stdio: "ignore" }); return true; } catch { return false; } }
async function up(url) { try { const r = await fetch(url + "/api/health", { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; } }

async function main() {
  mkdirSync(outDir, { recursive: true });
  if (!have("ffmpeg")) { console.error("✗ ffmpeg not found — install it (brew install ffmpeg). Skipping."); process.exit(1); }
  // Prefer full `playwright`; fall back to the repo's `playwright-core` (used by the overlay e2e) so no
  // extra install is needed — either way you still need the chromium binary (`npx playwright install chromium`).
  let pw;
  try { pw = await import("playwright"); }
  catch { try { pw = await import("playwright-core"); } catch { console.error("✗ neither playwright nor playwright-core is installed — `npx playwright install chromium`. Skipping."); process.exit(1); } }

  // Pin the demo crew deterministically (research→Scout, copy→Quill, design→Maestro). Override with
  // SAM_DEMO_CREW=<ids>. NOTE: this only takes effect on a server THIS script boots — if SAM is already
  // running, restart it with SAM_DEMO_CREW set, or the crew reverts to model planning.
  const crew = process.env.SAM_DEMO_CREW || "scout,quill,maestro";

  // Boot SAM if it isn't already serving.
  let server;
  if (!(await up(URL))) {
    console.log(`▸ booting SAM… (crew pinned: ${crew})`);
    server = spawn("node", ["dist/server.mjs"], { cwd: root, stdio: "ignore", detached: true, env: { ...process.env, SAM_DEMO_CREW: crew } });
    for (let i = 0; i < 30 && !(await up(URL)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await up(URL))) { console.error("✗ SAM didn't boot"); process.exit(1); }
  } else {
    console.warn(`⚠ SAM is already running — the pinned crew (${crew}) won't apply to it. Stop it and let this script boot SAM (with SAM_DEMO_CREW set) for a deterministic crew.`);
  }

  // Warn early if no brain is configured — otherwise the scripted prompt records an empty answer.
  // /api/keys → { local: { ollama }, providers: [{ id, keys }] }. A brain exists if a provider has a
  // key OR a local Ollama model is set. (Best-effort: it can't tell if Ollama is actually running.)
  try {
    const k = await (await fetch(URL + "/api/keys", { signal: AbortSignal.timeout(2000) })).json();
    const anyKeys = Array.isArray(k?.providers) && k.providers.some((p) => (p?.keys ?? 0) > 0);
    const ollama = !!k?.local?.ollama;
    if (!anyKeys && !ollama) console.warn("⚠ No AI brain configured (no provider keys in .env, no local Ollama). The scripted prompt will record an EMPTY answer — set up a brain before recording.");
    else if (!anyKeys && ollama) console.warn(`ℹ Only a local Ollama brain (${k.local.ollama}) is configured — make sure Ollama is actually running, or the demo answer will be empty.`);
  } catch { /* endpoint shape varies; non-fatal */ }

  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: outDir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  console.log("▸ recording…");
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // Handle onboarding if it appears.
  const nameInput = page.locator('input[placeholder="Your name"]');
  if (await nameInput.count()) { await nameInput.fill("Alex"); await page.getByText("Let's go").click().catch(() => {/* optional onboarding step — the recording continues if it is not shown */}); await page.waitForTimeout(1200); }

  for (const line of SCRIPT) {
    const box = page.locator("textarea, input[type=text]").last();
    await box.click();
    for (const ch of line) { await box.type(ch, { delay: 28 }); }   // human-paced typing reads well on GIF
    await box.press("Enter");
    await page.waitForTimeout(ANSWER_WAIT_MS);   // let the answer stream in visibly
  }
  await page.waitForTimeout(FINAL_HOLD_MS);   // hold on the payoff answer
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
  execSync(`ffmpeg -y -i "${mp4}" -vf "fps=10,scale=860:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${gif}"`, { stdio: "ignore" });
  console.log(`✓ wrote ${gif} + ${mp4}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
