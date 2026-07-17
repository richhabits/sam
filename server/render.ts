// ── HTML → MP4 video rendering (ported from heygen-com/hyperframes, Apache-2.0) ──
// The good part of hyperframes, adapted to SAM: not their framework (packages, Lambda, studio)
// but the ONE clever idea — deterministic rendering. We drive a virtual clock so time-based
// HTML/CSS/JS animations render frame-identical regardless of machine speed, screenshot each
// frame in headless Chrome (SAM already ships playwright-core), and encode with FFmpeg.
// "Write HTML. Render video." — same input always yields the same MP4.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";

// SAM's server is ESM; playwright-core is lazy-loaded via require (same pattern as tools.ts).
const require = createRequire(import.meta.url);

const IS_MAC = process.platform === "darwin";

function chromePath(): string {
  if (IS_MAC) return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  return "/usr/bin/google-chrome";
}

function ffmpegPath(): string | null {
  // Prefer the bundled static binary (ships with SAM → works on any machine, no install).
  try {
    const bundled = require("ffmpeg-static");
    if (typeof bundled === "string" && existsSync(bundled)) return bundled;
  } catch { /* not installed — fall back to a system ffmpeg */ }
  for (const p of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "ffmpeg"]) {
    if (p === "ffmpeg" || existsSync(p)) return p;
  }
  return null;
}

// Installed into the page BEFORE its own scripts run. Replaces the clock with a virtual one we
// step frame by frame, so nothing depends on wall-clock time. This is the determinism guarantee.
const VIRTUAL_CLOCK = `(() => {
  const EPOCH = 1700000000000;
  let vt = 0, rafId = 0; const raf = new Map();
  const _Date = Date;
  Date.now = () => EPOCH + vt;
  try { performance.now = () => vt; } catch (e) {}
  window.requestAnimationFrame = (cb) => { const id = ++rafId; raf.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => raf.delete(id);
  // step the world to absolute time t (ms): flush one rAF tick, pin declarative animations
  window.__samSeek = (t) => {
    vt = t;
    const cbs = Array.from(raf.values()); raf.clear();
    for (const cb of cbs) { try { cb(vt); } catch (e) {} }
    if (document.getAnimations) for (const a of document.getAnimations()) {
      try { a.pause(); a.currentTime = t; } catch (e) {}
    }
  };
})();`;

export interface RenderOpts {
  html: string;
  durationMs: number;
  fps?: number;          // default 30
  width?: number;        // default 1280
  height?: number;       // default 720
  out?: string;          // output mp4 path; default a temp file
}

export interface RenderResult {
  path: string;
  frames: number;
  fps: number;
  width: number;
  height: number;
  durationMs: number;
}

export async function renderVideo(opts: RenderOpts): Promise<RenderResult> {
  const fps = opts.fps ?? 30;
  // h264 + yuv420p requires even dimensions — round up so any requested size renders.
  const even = (n: number) => (n % 2 === 0 ? n : n + 1);
  const width = even(opts.width ?? 1280);
  const height = even(opts.height ?? 720);
  const frames = Math.max(1, Math.round((opts.durationMs / 1000) * fps));
  const ff = ffmpegPath();
  if (!ff) throw new Error("FFmpeg not found. Install it (macOS: `brew install ffmpeg`) and retry.");

  const work = join(tmpdir(), `sam-render-${Date.now()}`);
  mkdirSync(work, { recursive: true });
  const out = opts.out ?? join(work, "out.mp4");

  let browser: Browser | null = null;
  try {
    const { chromium } = require("playwright-core");
    browser = await chromium.launch({ executablePath: chromePath(), headless: true });
    const ctx = await browser!.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page: Page = await ctx.newPage();
    // Navigate to the HTML as a file:// URL (not setContent) so the init script reliably runs
    // BEFORE the page's own scripts — the virtual clock must be in place before any animation.
    const htmlPath = join(work, "index.html");
    writeFileSync(htmlPath, opts.html);
    await page.addInitScript({ content: VIRTUAL_CLOCK });
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
    const hasClock = await page.evaluate(() => typeof (window as any).__samSeek === "function");
    if (!hasClock) throw new Error("virtual clock failed to install — cannot guarantee determinism.");
    // Freeze all CSS animations so they never advance in real time between seeks — position is
    // driven ENTIRELY by currentTime. Without this, how far an animation auto-played before the
    // first capture varies run-to-run (a real pixel-level non-determinism). Then wait for fonts.
    await page.addStyleTag({ content:
      "*,*::before,*::after{animation-play-state:paused!important;-webkit-animation-play-state:paused!important}" });
    await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});

    for (let i = 0; i < frames; i++) {
      const t = (i * 1000) / fps;
      await page.evaluate((tt) => (window as any).__samSeek(tt), t);
      await page.screenshot({ path: join(work, `f_${String(i).padStart(5, "0")}.png`) });
    }
    await browser!.close();
    browser = null;

    await encode(ff, work, out, fps);
    return { path: out, frames, fps, width, height, durationMs: opts.durationMs };
  } finally {
    await browser?.close().catch(() => {});
    // keep the mp4, drop the frames
    if (!opts.out) { /* out lives in work; leave it */ }
    else rmSync(work, { recursive: true, force: true });
  }
}

function encode(ff: string, work: string, out: string, fps: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-framerate", String(fps), "-i", join(work, "f_%05d.png"),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps), out];
    const p = spawn(ff, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${err.slice(-400)}`)));
    p.on("error", reject);
  });
}

// ── built-in composition templates (the "agent skill" good part: a topic → a video, not raw HTML) ──
export function titleCard(o: { title: string; subtitle?: string; bg?: string; fg?: string }): string {
  const bg = o.bg ?? "#0a0a0a", fg = o.fg ?? "#ffffff";
  const sub = o.subtitle ? `<div class="sub">${escapeHtml(o.subtitle)}</div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:${bg};overflow:hidden;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
    .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
    .title{color:${fg};font-size:84px;font-weight:800;letter-spacing:-2px;opacity:0;
      transform:translateY(24px);animation:rise .8s cubic-bezier(.2,.7,.2,1) .2s forwards}
    .sub{color:${fg};opacity:0;font-size:32px;font-weight:500;margin-top:18px;
      animation:fade .8s ease .9s forwards}
    @keyframes rise{to{opacity:1;transform:translateY(0)}}
    @keyframes fade{to{opacity:.7}}
  </style></head><body><div class="wrap">
    <div class="title">${escapeHtml(o.title)}</div>${sub}
  </div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
