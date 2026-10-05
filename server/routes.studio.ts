import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { isLoopback } from "./http-guards.ts";
import { runModel } from "./models.ts";
import * as notebook from "./notebook.ts";
import { createRateLimiter } from "./rate-limit.ts";
import {
  buildCharacterAnchorPrompt,
  type CharacterProfile,
  compileHiggsfieldMotionPrompt,
  generateStoryboardDirector,
  HIGGSFIELD_CAMERA_RIGS,
  HIGGSFIELD_LENSES,
  HIGGSFIELD_PHYSICS,
} from "./studio-higgsfield.ts";
import { enqueueStudioJob, listStudioJobs } from "./studio-queue.ts";
import { renderStillShot } from "./studio-shot.ts";
import { TOOLS } from "./tools.ts";
import { safeFetch } from "./url-guard.ts";

// STUDIO + NOTEBOOKS — image/video generation, and the vault media cache that serves generated
// images SAME-ORIGIN so no service-worker or CSP quirk can break them.
//
// The two markdown helpers travel WITH this block: they are used only here, so leaving them in
// index.ts would have made them shared state for no reason. Paths and registration order
// unchanged (registerX(app), not a Router).
export function registerStudioRoutes(app: Express) {
  // Media is read straight off disk and a gallery loads many tiles at once: 300/min per IP.
  const mediaLimit = createRateLimiter({ max: 300, message: "Too many media requests. Please slow down." });

  // ── 📓 NOTEBOOKS (NotebookLM UI backend) — grounded Q&A + audio overview over YOUR sources ──
  // ── 🎨 STUDIO — free-first image/video generation (Pollinations → keyed lanes), no MUAPI needed ──
  const urlFromMarkdown = (md: string) => { const m = String(md||"").match(/\((https?:\/\/[^)\s]+)\)/); return m ? m[1] : ""; };
  // A generated image is a http URL (Pollinations/Together/…) or a data: URI (Cloudflare/HF/NVIDIA base64 lanes).
  const mediaFromMarkdown = (md: string) => { const m = String(md||"").match(/\((data:image\/[^)\s]+|https?:\/\/[^)\s]+)\)/); return m ? m[1] : ""; };

  // ── Generated images are cached to the vault and served SAME-ORIGIN (/api/studio/media/…) so no
  //    service-worker or CSP cross-origin quirk can ever break them. `ref` is a URL from a
  //    generation provider's own API response (Pollinations/Cloudflare/HF/NVIDIA/…), never typed by
  //    the user directly — but it's still server-side fetching a URL this process doesn't fully
  //    control, so it goes through the same SSRF guard as every other outbound fetch of
  //    externally-sourced URLs (a compromised or misbehaving provider is exactly the case this
  //    defends against; safeFetch just returns a normal failure here, caught below).
  const GEN_DIR = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "studio-gen");
  async function cacheStudioMedia(ref: string): Promise<string | null> {
    try {
      let buf: Buffer = Buffer.alloc(0), ext = "jpg";
      if (ref.startsWith("data:")) {
        const m = ref.match(/^data:image\/(\w+);base64,(.*)$/); if (!m) return null;
        ext = m[1] === "png" ? "png" : m[1] === "webp" ? "webp" : "jpg";
        buf = Buffer.from(m[2], "base64");
      } else {
        // Retry until we get real bytes — Pollinations can 200 with an EMPTY body on the GET that
        // immediately follows the tool's HEAD probe; a moment later it returns the actual image.
        let ct = "";
        for (let attempt = 0; attempt < 4 && !buf.length; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 1500));
          const r = await safeFetch(ref, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) continue;
          buf = Buffer.from(await r.arrayBuffer());
          ct = r.headers.get("content-type") || "";
        }
        ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
      }
      if (!buf.length) return null;
      const name = createHash("sha1").update(ref).digest("hex").slice(0, 16) + "." + ext;
      await mkdir(GEN_DIR, { recursive: true });
      await writeFile(join(GEN_DIR, name), buf);
      // keep the 60 most-recent generations, prune the rest so the vault never balloons
      try {
        const entries = await readdir(GEN_DIR);
        const stats = await Promise.all(entries.map(async (f) => {
          try { return { f, t: (await stat(join(GEN_DIR, f))).mtimeMs }; }
          catch { return null; }
        }));
        const valid = stats.filter((s): s is { f: string; t: number } => s !== null);
        valid.sort((a, b) => b.t - a.t);
        for (const { f } of valid.slice(60)) {
          await unlink(join(GEN_DIR, f)).catch(() => { /* already gone, or a concurrent prune won the race */ });
        }
      } catch { /* generated-media dir may not exist yet — nothing to prune */ }
      return name;
    } catch (e: any) { console.error("[studio] cacheStudioMedia failed:", e?.message || e); return null; }
  }

  async function cacheStudioBytes(buf: Buffer, ext: string): Promise<string | null> {
    if (!buf.length) return null;
    const name = createHash("sha1").update(buf).digest("hex").slice(0, 16) + "." + ext;
    await mkdir(GEN_DIR, { recursive: true });
    await writeFile(join(GEN_DIR, name), buf);
    return name;
  }

  async function loadStudioStill(ref: string | undefined, prompt: string, w: number, h: number): Promise<{ buf: Buffer; stillUrl?: string } | null> {
    if (ref) {
      const id = ref.replace(/^.*\/api\/studio\/media\//, "").replace(/[^a-zA-Z0-9._-]/g, "");
      if (id && existsSync(join(GEN_DIR, id))) {
        try { return { buf: await readFile(join(GEN_DIR, id)), stillUrl: `/api/studio/media/${id}` }; } catch { /* fall through */ }
      }
    }
    try {
      const seed = randomBytes(4).readUInt32BE(0);
      const purl = `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0, 900))}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
      const name = await cacheStudioMedia(purl);
      if (name) return { buf: await readFile(join(GEN_DIR, name)), stillUrl: `/api/studio/media/${name}` };
    } catch { /* keyed / empty */ }
    return null;
  }

  async function encodeFreeShot(opts: { prompt: string; stillUrl?: string; width?: number; height?: number; motion?: string; intensity?: number; duration?: number; audioText?: string }) {
    const w = Math.min(Number(opts.width) || 1280, 1440);
    const h = Math.min(Number(opts.height) || 720, 1440);
    const still = await loadStudioStill(opts.stillUrl, opts.prompt, w, h);
    if (!still) return { error: "Could not make a still for the free clip lane." };
    const clip = await renderStillShot(still.buf, {
      rig: opts.motion, intensity: opts.intensity, durationSec: opts.duration, width: w, height: h,
    }, opts.audioText);
    const name = await cacheStudioBytes(clip, "mp4");
    if (!name) return { error: "Could not cache the clip." };
    return { url: `/api/studio/media/${name}`, still: still.stillUrl, lane: "free-motion" as const };
  }

  app.post("/api/studio/queue", (req, res) => {
    const { concept, style, localOnly } = req.body;
    if (!concept || typeof concept !== "string") {
      return res.status(400).json({ error: "concept is required and must be a string" });
    }
    const id = enqueueStudioJob(concept, style || "", !!localOnly);
    return res.json({ id, concept, status: "queued" });
  });
  app.get("/api/studio/queue", (_req, res) => {
    try { res.json({ jobs: listStudioJobs(20) }); }
    catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });

  app.get("/api/studio/media/:id", mediaLimit, async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9._-]/g, "");   // strip any path-traversal
    const file = join(GEN_DIR, id);
    if (!id || !existsSync(file)) return res.status(404).end();
    const ext = id.split(".").pop();
    try {
      const data = await readFile(file);
      const type = ext === "mp4" ? "mp4" : ext === "png" ? "png" : ext === "webp" ? "webp" : "jpeg";
      res.type(type).send(data);
    } catch {
      res.status(404).end();
    }
  });
  app.post("/api/studio/image", async (req, res) => {
    const { prompt, width, height } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "no prompt" });
    const w = Math.min(Number(width) || 1024, 1440), h = Math.min(Number(height) || 1024, 1440);
    // FREE no-key lane first: build the Pollinations URL ourselves and fetch the bytes directly (no HEAD
    // probe → avoids the empty-body quirk the generate_image tool hits), then cache same-origin.
    try {
      const seed = randomBytes(4).readUInt32BE(0);
      const purl = `https://image.pollinations.ai/prompt/${encodeURIComponent(String(prompt).slice(0, 900))}?width=${w}&height=${h}&nologo=true&seed=${seed}`;
      const name = await cacheStudioMedia(purl);
      if (name) return res.json({ url: `/api/studio/media/${name}` });
    } catch { /* best-effort — nothing downstream depends on this succeeding */ }
    // Fall back to the keyed matrix (Cloudflare/HF/NVIDIA/… → http URL or data URI) and cache that too.
    const t = TOOLS.find((x) => x.name === "generate_image");
    if (t) {
      try {
        const out = await t.run({ prompt, width, height });
        const ref = mediaFromMarkdown(out);
        if (ref) { const name = await cacheStudioMedia(ref); return res.json({ url: name ? `/api/studio/media/${name}` : ref }); }
        return res.json({ error: out });
      } catch (e: any) { return res.status(500).json({ error: String(e?.message || e) }); }
    }
    res.status(500).json({ error: "image tool missing" });
  });
  app.post("/api/studio/video", async (req, res) => {
    const { prompt, width, height, motion, intensity, duration, stillUrl, audioText, preferFree } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "no prompt" });
    // Keyed lanes first when a credit key exists — unless the client asked for the free clip.
    if (!preferFree) {
      const t = TOOLS.find((x) => x.name === "generate_video");
      if (t) {
        try {
          const out = await t.run({ prompt });
          const url = urlFromMarkdown(out);
          if (url) {
            const name = await cacheStudioMedia(url);
            return res.json({ url: name ? `/api/studio/media/${name}` : url, lane: "keyed" });
          }
        } catch { /* free Ken Burns still plays */ }
      }
    }
    try {
      const shot = await encodeFreeShot({ prompt, stillUrl, width, height, motion, intensity, duration, audioText });
      if (shot.url) return res.json(shot);
      return res.json({ error: shot.error || "Video lane missed." });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.post("/api/studio/vary", async (req, res) => {
    const { prompt, width, height, motion, intensity } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "no prompt" });
    try {
      const shot = await encodeFreeShot({ prompt, width, height, motion, intensity });
      if (shot.url) return res.json({ ...shot, kind: "variation" });
      return res.json({ error: shot.error || "Variation missed." });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.post("/api/studio/extend", async (req, res) => {
    const { prompt, stillUrl, width, height, motion, intensity, duration, audioText } = req.body || {};
    if (!prompt && !stillUrl) return res.status(400).json({ error: "prompt or still required" });
    try {
      const shot = await encodeFreeShot({
        prompt: String(prompt || "continue the shot"),
        stillUrl, width, height, motion, intensity,
        duration: Number(duration) || 8,
        audioText,
      });
      if (shot.url) return res.json({ ...shot, kind: "extend" });
      return res.json({ error: shot.error || "Extend missed." });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });
  // Style-card preview thumbnails — generated ONCE via Pollinations, cached to the vault, served
  // locally (instant after first boot). Same-origin so no CSP/SW issues, and one per style, generated once.
  const STUDIO_PREVIEWS: Record<string, string> = {
    cinematic: "cinematic portrait, dramatic rim lighting, film grain, moody",
    photoreal: "photorealistic landscape, golden hour, ultra detailed, 8k",
    anime: "anime girl, cel shaded, vibrant colours, studio ghibli",
    "3d": "cute 3d character render, octane, soft lighting, pixar",
    product: "luxury perfume bottle product shot, studio lighting, clean",
    neon: "cyberpunk city street, neon signs, rain, night, blade runner",
    vapor: "vaporwave sunset, palm trees, pink and teal grid, retro chrome",
    clay: "claymation fox character, stop-motion, plasticine, soft light",
    dusk: "cinematic dusk landscape, golden hour haze, warm anamorphic lens flare",
    noir: "high contrast noir detective scene, dramatic chiaroscuro lighting, deep shadows",
    golden: "perfect golden hour cinematic shot, warm sunlight, beautiful lens flare",
    cyber: "cyberpunk neon alley, wet asphalt, glowing signs, dark futuristic atmosphere",
  };
  // Every id in src/StudioView.tsx's STYLES must have an entry above, or that style card renders
  // blank (the route 404s and the CSS background-image resolves to nothing). These four were
  // missing. server/studio.previews.test.ts holds the parity so it cannot silently drift again.
  const PREVIEW_DIR = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "studio-previews");
  async function genPreview(id: string): Promise<Buffer | null> {
    const prompt = STUDIO_PREVIEWS[id]; if (!prompt) return null;
    try {
      const u = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=220&height=150&nologo=true&seed=${id.length + 3}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        await mkdir(PREVIEW_DIR, { recursive: true });
        await writeFile(join(PREVIEW_DIR, `${id}.jpg`), buf);
        return buf;
      }
    } catch { /* best-effort — nothing downstream depends on this succeeding */ }
    return null;
  }
  app.get("/api/studio/preview/:style", async (req, res) => {
    const id = String(req.params.style); if (!STUDIO_PREVIEWS[id]) return res.status(404).end();
    const file = join(PREVIEW_DIR, `${id}.jpg`);
    if (existsSync(file)) {
      try {
        const data = await readFile(file);
        return res.type("jpeg").send(data);
      } catch { /* cached file vanished/unreadable — fall through and regenerate it */ }
    }
    const buf = await genPreview(id);
    if (buf) return res.type("jpeg").send(buf);
    res.status(503).end();
  });
  // Pre-warm the previews in the background at boot (once) so the Studio is snappy.
  if (process.env.NODE_ENV !== "test" && !process.env.VITEST && process.env.SAM_BENCH_MOCK !== "1") {
    const timer = setTimeout(async () => {
      const missing = Object.keys(STUDIO_PREVIEWS).filter((id) => !existsSync(join(PREVIEW_DIR, `${id}.jpg`)));
      await Promise.allSettled(missing.map((id) => genPreview(id)));
    }, 4000);
    if (typeof timer.unref === "function") timer.unref();
  }

  const CAMERA_PRESETS = [
    { id: "dolly_in", label: "Dolly In", desc: "Smooth cinematic push in towards the subject" },
    { id: "dolly_out", label: "Dolly Out", desc: "Slow cinematic pull back revealing the wider environment" },
    { id: "orbit_left", label: "Orbit Left", desc: "Smooth 360-degree rotation around the subject counter-clockwise" },
    { id: "orbit_right", label: "Orbit Right", desc: "Smooth 360-degree rotation around the subject clockwise" },
    { id: "crane_up", label: "Crane Up", desc: "Sweeping vertical jib crane ascent looking down" },
    { id: "crane_down", label: "Crane Down", desc: "Dramatic descending crane swoop to eye level" },
    { id: "fpv_drone", label: "FPV Drone", desc: "High-speed dynamic aerobatic first-person drone flight" },
    { id: "whip_pan", label: "Whip Pan", desc: "Fast motion-blurred transition snap between perspectives" },
    { id: "bullet_time", label: "Bullet Time", desc: "Matrix-style frozen time orbital camera wrap" },
    { id: "dutch_angle", label: "Dutch Angle", desc: "Tilted canted horizon conveying tension and drama" },
    { id: "tracking_shot", label: "Tracking Shot", desc: "Parallel tracking alongside the moving subject" },
    { id: "vertigo_zoom", label: "Vertigo Dolly Zoom", desc: "Hitchcock dolly zoom with background expansion" },
    { id: "low_angle_hero", label: "Low Angle Hero", desc: "Ground-level upward hero perspective" },
    { id: "overhead_god", label: "Overhead God View", desc: "Top-down 90-degree bird's eye perspective" },
    { id: "macro_glide", label: "Macro Glide", desc: "Ultra close-up microscopic glide across textures" },
    { id: "handheld_raw", label: "Handheld Raw", desc: "Gritty documentary-style handheld camera sway" }
  ];

  app.get("/api/studio/presets/cameras", (_req, res) => {
    res.json({ cameras: CAMERA_PRESETS });
  });

  app.get("/api/studio/presets/motion", (_req, res) => {
    res.json({
      cameras: HIGGSFIELD_CAMERA_RIGS,
      physics: HIGGSFIELD_PHYSICS,
    });
  });

  app.get("/api/studio/presets/lenses", (_req, res) => {
    res.json({ lenses: HIGGSFIELD_LENSES });
  });

  app.post("/api/studio/storyboard", async (req, res) => {
    const { concept, shotCount, style, character } = req.body || {};
    if (!concept) return res.status(400).json({ error: "no concept provided" });
    try {
      const storyboard = await generateStoryboardDirector({
        concept: String(concept),
        shotCount: Number(shotCount) || 4,
        style: style ? String(style) : undefined,
        character: character as CharacterProfile,
      });
      res.json(storyboard);
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e) });
    }
  });

  app.post("/api/studio/character/consistency", (req, res) => {
    const char = req.body as CharacterProfile;
    if (!char?.name) return res.status(400).json({ error: "character name required" });
    const anchorPrompt = buildCharacterAnchorPrompt(char);
    res.json({
      characterId: char.characterId || `char_${Date.now()}`,
      anchorPrompt,
      tokens: char.distinctTokens || [],
    });
  });

  app.post("/api/studio/motion/control", (req, res) => {
    const { basePrompt, cameraRigId, lensId, physicsId, motionIntensity, aspectRatio, characterProfile, seed } = req.body || {};
    if (!basePrompt) return res.status(400).json({ error: "basePrompt required" });
    const synthesis = compileHiggsfieldMotionPrompt({
      basePrompt: String(basePrompt),
      cameraRigId,
      lensId,
      physicsId,
      motionIntensity: Number(motionIntensity) || 1.0,
      aspectRatio,
      characterProfile,
      seed,
    });
    res.json(synthesis);
  });

  app.post("/api/studio/lipsync", (req, res) => {
    const { prompt, speaker, transcript } = req.body || {};
    if (!prompt && !transcript) return res.status(400).json({ error: "prompt or transcript required" });
    const voiceSyncPrompt = `Realistic talking head animation, high-fidelity lip sync with precise phoneme viseme articulation matching spoken speech: "${String(transcript || prompt).slice(0, 300)}", micro-expressions, subtle natural eye blinks, facial muscle movement, head tilt pacing, cinematic studio portrait lighting.`;
    res.json({
      speaker: speaker || "Actor",
      lipSyncPrompt: voiceSyncPrompt,
      aspectRatio: "16:9",
      negativePrompt: "mouth distortion, unnatural teeth, audio desync, robotic jaw movement, plastic skin",
    });
  });

  app.post("/api/studio/enhance", async (req, res) => {
    const p = String(req.body?.prompt || "").trim();
    const style = req.body?.style ? ` Style preset: ${req.body.style}.` : "";
    const camera = req.body?.camera ? ` Camera motion: ${req.body.camera}.` : "";
    if (!p) return res.status(400).json({ error: "no prompt" });
    const sys = `You are a prompt engineer for AI image/video generation. Rewrite the user's idea into ONE vivid, specific, cinematic prompt (subject, setting, lighting, mood, lens, motion).${style}${camera} Output ONLY the improved prompt, no quotes, no preamble, under 60 words.`;
    try { const r = await runModel("free", sys, p); res.json({ prompt: (r.text || p).replace(/^["']|["']$/g, "").trim() }); }
    catch { res.json({ prompt: p }); }
  });
  app.get("/api/notebooks", (_req, res) => res.json({ notebooks: notebook.listNotebooks() }));
  app.post("/api/notebooks", (req, res) => res.json(notebook.ensureNotebook(String(req.body?.title || "Notebook"))));
  app.get("/api/notebooks/:id/sources", (req, res) => res.json({ sources: notebook.notebookSources(req.params.id) }));
  app.delete("/api/notebooks/:id", (req, res) => res.json({ ok: notebook.deleteNotebook(req.params.id) }));
  app.post("/api/notebooks/:id/source", async (req, res) => {
    const { url, file, text, title } = req.body || {};
    try {
      if (url) { const r = await notebook.addUrl(req.params.id, String(url)); return res.json({ ok: true, chunks: r.chunks, title: r.title }); }
      // A server-side PATH, ingested whole and then answerable through /ask: with no check this is
      // "read any file the SAM process can see" for any paired phone (~/.ssh, .env, the vault). A path
      // only means something on the machine SAM runs on, so only that machine may name one — a phone
      // still adds URLs and pasted text.
      if (file && !isLoopback(req)) return res.status(403).json({ error: "files can only be added from this computer, not remotely" });
      if (file) { const c = await notebook.addFile(req.params.id, String(file).replace(/^~/, os.homedir())); return res.json({ ok: true, chunks: c }); }
      if (text) { const c = await notebook.addText(req.params.id, String(title || "note"), String(text)); return res.json({ ok: true, chunks: c }); }
      res.status(400).json({ error: "need url, file, or text" });
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });
  app.post("/api/notebooks/:id/ask", async (req, res) => {
    const q = String(req.body?.question || "").trim();
    if (!q) return res.status(400).json({ error: "no question" });
    const passages = await notebook.retrieve(req.params.id, q, 8);
    if (!passages.length) return res.json({ answer: "This notebook has nothing on that yet — add sources first.", citations: [] });
    const ctx = passages.map((p, n) => `[${n + 1}] (${p.title})\n${p.text}`).join("\n\n");
    const sys = "You answer STRICTLY from the provided sources — a grounded research assistant. Never use outside knowledge. Cite each claim with its [n] number. If the sources don't cover it, say so plainly. Be clear and well-organised.";
    const r = await runModel("free", sys, `SOURCES:\n${ctx}\n\nQUESTION: ${q}\n\nAnswer using ONLY the sources above, citing [n]:`);
    res.json({ answer: r.text, citations: [...new Set(passages.map((p) => p.title))], provider: r.provider });
  });
  app.post("/api/notebooks/:id/audio", async (req, res) => {
    const chunks = notebook.overviewChunks(req.params.id, 12);
    if (!chunks.length) return res.json({ script: "" });
    const material = chunks.map((c) => `• (${c.title}) ${c.text.slice(0, 600)}`).join("\n");
    const sys = "You are a producer writing a short, engaging two-host podcast (hosts: Alex and Sam) that explains the user's material in an accessible, curious way. Natural dialogue, hand-offs, a few 'oh interesting' beats — no fluff, all grounded in the material. 8-14 exchanges. Format each line as 'Alex: …' / 'Sam: …'.";
    const r = await runModel("free", sys, `MATERIAL:\n${material}\n\nWrite the audio-overview script:`);
    res.json({ script: r.text });
  });
}
