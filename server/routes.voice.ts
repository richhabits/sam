// ─────────────────────────────────────────────────────────────
//  S.A.M. · VOICE / TTS ROUTES — free-first lanes, works with zero keys
//
//  Extracted from server/index.ts (audit finding #2). Chosen from the coupling table in
//  docs/DESIGN-AUDIT.md: this section closed over NO index.ts-local state, only `app` itself.
//
//  Lane order: ElevenLabs (paid key) → Groq (optional free key) → macOS `say` (local) → 503
//  so the HUD uses the browser's speechSynthesis. No Pollinations phone-home.
// ─────────────────────────────────────────────────────────────
import type { Express } from "express";
import { getKey, } from "./keys.ts";
import { VOICES, synthesizeDialogueAudio } from "./audio-engine.ts";

export function registerVoiceRoutes(app: Express): void {
  // ── ElevenLabs premium voice (optional; free browser voice used otherwise) ──
  // TTS — rotating free-first lanes, works OUT OF THE BOX with zero keys:
  //   1. ElevenLabs (premium voice — only if you added a key; bills per char, so capped)
  //   2. Groq TTS (free tier, if a Groq key is set)
  //   3. Pollinations openai-audio (FREE, NO key — the out-of-the-box voice)
  // Client falls back to the browser's built-in voice if all lanes miss.
  app.post("/api/speak", async (req, res) => {
    const text = String(req.body?.text || "").slice(0, 800); // cap chars (premium bills per char)
    if (!text.trim()) return res.status(400).json({ error: "no text" });
    const sendAudio = (buf: ArrayBuffer | Buffer, type = "audio/mpeg") => {
      res.setHeader("Content-Type", type);
      res.send(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    };
    // LANE 1 · ElevenLabs (premium)
    const EL_KEY = process.env.ELEVENLABS_API_KEY || "";           // read live (Admin can update it)
    if (EL_KEY) {
      try {
        const EL_VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
        const EL_MODEL = process.env.ELEVENLABS_MODEL || "eleven_turbo_v2_5";
        const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}?output_format=mp3_44100_128`, {
          method: "POST", headers: { "xi-api-key": EL_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ text, model_id: EL_MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } }),
        });
        if (r.ok) return sendAudio(await r.arrayBuffer());
      } catch { /* fall through */ }
    }
    // LANE 2 · Groq TTS (free tier — only if a Groq key is set; not required)
    const gk = getKey("groq");
    if (gk) {
      try {
        const r = await fetch("https://api.groq.com/openai/v1/audio/speech", {
          method: "POST", headers: { Authorization: `Bearer ${gk}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "playai-tts", voice: "Fritz-PlayAI", input: text, response_format: "mp3" }),
        });
        if (r.ok) return sendAudio(await r.arrayBuffer());
      } catch { /* fall through */ }
    }
    // LANE 3 · this Mac's `say` (local, no key, no network). HUD still has browser speechSynthesis
    // if this misses. Pollinations was a 30s phone-home that blocked the free path.
    if (process.platform === "darwin") {
      try {
        const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const run = promisify(execFile);
        const dir = mkdtempSync(join(tmpdir(), "sam-say-"));
        const out = join(dir, "out.aiff");
        await run("say", ["-o", out, text], { timeout: 15000 });
        const buf = readFileSync(out);
        rmSync(dir, { recursive: true, force: true });
        if (buf.length) return sendAudio(buf, "audio/aiff");
      } catch { /* fall through to browser */ }
    }
    res.status(503).json({ error: "no tts lane available", fallback: "browser" });
  });

  // Audio Engine Voice Catalog
  app.get("/api/audio/voices", (_req, res) => {
    res.json({ voices: VOICES });
  });

  // Multi-Speaker Dialogue / Podcast Synthesis
  app.post("/api/audio/dialogue", async (req, res) => {
    const { title, exchanges } = req.body as { title?: string; exchanges: Array<{ speaker: string; text: string }> };
    if (!Array.isArray(exchanges) || exchanges.length === 0) {
      return res.status(400).json({ error: "exchanges array is required" });
    }
    try {
      const result = await synthesizeDialogueAudio(title || "Audio Overview Dialogue", exchanges);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to synthesize audio" });
    }
  });
}
