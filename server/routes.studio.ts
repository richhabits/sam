import os from "node:os";
import type { Express } from "express";
import * as notebook from "./notebook.ts";
import { runModel } from "./models.ts";
import { TOOLS } from "./tools.ts";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// STUDIO + NOTEBOOKS — image/video generation, and the vault media cache that serves generated
// images SAME-ORIGIN so no service-worker or CSP quirk can break them.
//
// The two markdown helpers travel WITH this block: they are used only here, so leaving them in
// index.ts would have made them shared state for no reason. Paths and registration order
// unchanged (registerX(app), not a Router).
export function registerStudioRoutes(app: Express) {
  // ── 📓 NOTEBOOKS (NotebookLM UI backend) — grounded Q&A + audio overview over YOUR sources ──
  // ── 🎨 STUDIO — free-first image/video generation (Pollinations → keyed lanes), no MUAPI needed ──
  const urlFromMarkdown = (md: string) => { const m = String(md||"").match(/\((https?:\/\/[^)\s]+)\)/); return m ? m[1] : ""; };
  // A generated image is a http URL (Pollinations/Together/…) or a data: URI (Cloudflare/HF/NVIDIA base64 lanes).
  const mediaFromMarkdown = (md: string) => { const m = String(md||"").match(/\((data:image\/[^)\s]+|https?:\/\/[^)\s]+)\)/); return m ? m[1] : ""; };

  // ── Generated images are cached to the vault and served SAME-ORIGIN (/api/studio/media/…) so no
  //    service-worker or CSP cross-origin quirk can ever break them. The `ref` always comes from SAM's
  //    own media matrix (never user input), so this is not an open proxy.
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
          const r = await fetch(ref, { signal: AbortSignal.timeout(45000) });
          if (!r.ok) continue;
          buf = Buffer.from(await r.arrayBuffer());
          ct = r.headers.get("content-type") || "";
        }
        ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
      }
      if (!buf.length) return null;
      const name = createHash("sha1").update(ref).digest("hex").slice(0, 16) + "." + ext;
      mkdirSync(GEN_DIR, { recursive: true });
      writeFileSync(join(GEN_DIR, name), buf);
      // keep the 60 most-recent generations, prune the rest so the vault never balloons
      try { readdirSync(GEN_DIR).map((f) => ({ f, t: statSync(join(GEN_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t).slice(60).forEach(({ f }) => { try { unlinkSync(join(GEN_DIR, f)); } catch { /* file already gone — that is the desired end state */ } }); } catch { /* generated-media dir may not exist yet — nothing to prune */ }
      return name;
    } catch (e: any) { console.error("[studio] cacheStudioMedia failed:", e?.message || e); return null; }
  }
  app.get("/api/studio/media/:id", (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9._-]/g, "");   // strip any path-traversal
    const file = join(GEN_DIR, id);
    if (!id || !existsSync(file)) return res.status(404).end();
    const ext = id.split(".").pop();
    res.type(ext === "png" ? "png" : ext === "webp" ? "webp" : "jpeg").send(readFileSync(file));
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
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "no prompt" });
    const t = TOOLS.find((x) => x.name === "generate_video");
    if (!t) return res.status(500).json({ error: "video tool missing" });
    try { const out = await t.run({ prompt }); const url = urlFromMarkdown(out); res.json(url ? { url } : { error: out }); }
    catch (e: any) { res.status(500).json({ error: String(e?.message || e) }); }
  });
  // Style-card preview thumbnails — generated ONCE via Pollinations, cached to the vault, served
  // locally (instant after first boot). Same-origin so no CSP/SW issues, and only 12 ever generated.
  const STUDIO_PREVIEWS: Record<string, string> = {
    cinematic: "cinematic portrait, dramatic rim lighting, film grain, moody",
    photoreal: "photorealistic landscape, golden hour, ultra detailed, 8k",
    anime: "anime girl, cel shaded, vibrant colours, studio ghibli",
    "3d": "cute 3d character render, octane, soft lighting, pixar",
    product: "luxury perfume bottle product shot, studio lighting, clean",
    logo: "minimal geometric vector logo mark, flat, bold",
    neon: "cyberpunk city street, neon signs, rain, night, blade runner",
    oil: "classical oil painting portrait, thick brushstrokes, renaissance",
    water: "watercolour floral illustration, soft, delicate washes",
    pixel: "16-bit pixel art fantasy village, retro game scene",
    comic: "comic book superhero, bold ink, halftone, dynamic action",
    fantasy: "epic fantasy castle, dragons, magic, dramatic sky, concept art",
  };
  const PREVIEW_DIR = join(process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault"), "studio-previews");
  async function genPreview(id: string): Promise<Buffer | null> {
    const prompt = STUDIO_PREVIEWS[id]; if (!prompt) return null;
    try {
      const u = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=220&height=150&nologo=true&seed=${id.length + 3}`;
      const r = await fetch(u, { signal: AbortSignal.timeout(45000) });
      if (r.ok) { const buf = Buffer.from(await r.arrayBuffer()); mkdirSync(PREVIEW_DIR, { recursive: true }); writeFileSync(join(PREVIEW_DIR, `${id}.jpg`), buf); return buf; }
    } catch { /* best-effort — nothing downstream depends on this succeeding */ }
    return null;
  }
  app.get("/api/studio/preview/:style", async (req, res) => {
    const id = String(req.params.style); if (!STUDIO_PREVIEWS[id]) return res.status(404).end();
    const file = join(PREVIEW_DIR, `${id}.jpg`);
    if (existsSync(file)) return res.type("jpeg").send(readFileSync(file));
    const buf = await genPreview(id);
    if (buf) return res.type("jpeg").send(buf);
    res.status(503).end();
  });
  // Pre-warm the 12 previews in the background at boot (once) so the Studio is snappy.
  setTimeout(async () => { for (const id of Object.keys(STUDIO_PREVIEWS)) { if (!existsSync(join(PREVIEW_DIR, `${id}.jpg`))) await genPreview(id).catch(() => {/* best-effort — nothing downstream depends on this succeeding */}); } }, 4000);

  app.post("/api/studio/enhance", async (req, res) => {
    const p = String(req.body?.prompt || "").trim();
    if (!p) return res.status(400).json({ error: "no prompt" });
    const sys = "You are a prompt engineer for AI image/video generation. Rewrite the user's idea into ONE vivid, specific, cinematic prompt (subject, setting, lighting, mood, lens, detail). Output ONLY the improved prompt, no quotes, no preamble, under 60 words.";
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
