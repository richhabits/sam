// ─────────────────────────────────────────────────────────────
//  S.A.M. · VOICE / TTS ROUTES — free-first lanes, works with zero keys
//
//  Extracted from server/index.ts (audit finding #2). Chosen from the coupling table in
//  docs/DESIGN-AUDIT.md: this section closed over NO index.ts-local state, only `app` itself.
//
//  `registerX(app)` rather than an Express Router: a Router with a mount point would change the
//  route paths, while passing `app` keeps paths and registration order byte-identical.
//  Lane order (ElevenLabs -> Groq -> Pollinations -> browser) is unchanged.
// ─────────────────────────────────────────────────────────────
import type { Express } from "express";
import { getKey, } from "./keys.ts";

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
    const sendAudio = (buf: ArrayBuffer, type = "audio/mpeg") => { res.setHeader("Content-Type", type); res.send(Buffer.from(buf)); };
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
    // LANE 2 · Groq TTS (free tier)
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
    // LANE 3 · Pollinations (FREE, no key — out-of-the-box voice)
    try {
      const r = await fetch(`https://text.pollinations.ai/${encodeURIComponent(text)}?model=openai-audio&voice=nova`, { signal: AbortSignal.timeout(30000) });
      if (r.ok && (r.headers.get("content-type") || "").includes("audio")) return sendAudio(await r.arrayBuffer(), r.headers.get("content-type") || "audio/mpeg");
    } catch { /* nothing left */ }
    res.status(503).json({ error: "no tts lane available" });
  });
}
