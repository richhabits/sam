import { useState } from "react";

// 🎨 SAM Studio — Higgsfield-style Creative Space, our own slim build.
// Two-pane: left command center (30%) + right immersive canvas (70%). Visual
// template cards instead of raw CFG/steps/seed. Routes through SAM's key-hiding
// /api/creative proxy; degrades honestly when no image key is set.

const STYLES = [
  { id: "cinematic", label: "Cinematic", emoji: "🎬", suffix: "cinematic, film grain, dramatic lighting, 35mm" },
  { id: "photoreal", label: "Photoreal", emoji: "📷", suffix: "photorealistic, ultra-detailed, natural light, 8k" },
  { id: "anime", label: "Anime", emoji: "🌸", suffix: "anime style, cel-shaded, vibrant, studio quality" },
  { id: "3d", label: "3D Render", emoji: "🧊", suffix: "3D render, octane, soft global illumination, isometric" },
  { id: "logo", label: "Logo / Vector", emoji: "✏️", suffix: "clean vector logo, flat, minimal, high contrast" },
  { id: "neon", label: "Cyberpunk", emoji: "🌆", suffix: "cyberpunk, neon, moody, volumetric fog" },
];

export default function StudioView() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"image" | "video">("image");
  const [style, setStyle] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError("");
    const suffix = STYLES.find((s) => s.id === style)?.suffix;
    const full = suffix ? `${prompt.trim()}, ${suffix}` : prompt.trim();
    try {
      const path = mode === "video" ? "videos/generations" : "images/generations";
      const r = await fetch(`/api/creative/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: full, n: 1 }),
      });
      if (r.status === 503) { setError("🔑 Add an image key (MUAPI, or a free HuggingFace / SiliconFlow key) in Admin → API keys."); return; }
      const d = await r.json().catch(() => ({}));
      const urls: string[] = (
        d?.data?.map((x: any) => x.url || (x.b64_json && `data:image/png;base64,${x.b64_json}`)) ||
        d?.images || (d?.url ? [d.url] : [])
      ).filter(Boolean);
      if (urls.length) setMedia((g) => [...urls, ...g]);
      else setError("The provider replied without media in a shape I recognised — check the key/endpoint.");
    } catch (e: any) { setError("Couldn't reach the Studio backend: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  const isVideo = (src: string) => /\.(mp4|webm|mov)(\?|$)/i.test(src);
  const latest = media[0];

  return (
    <div className="studio2">
      {/* ── LEFT: command center ── */}
      <aside className="st-panel">
        <div className="st-brand">🎨 SAM <b>Studio</b></div>

        <div className="st-tabs">
          <button className={mode === "image" ? "on" : ""} onClick={() => setMode("image")}>Image</button>
          <button className={mode === "video" ? "on" : ""} onClick={() => setMode("video")}>Video</button>
        </div>

        <div className="st-label">Style</div>
        <div className="st-styles">
          {STYLES.map((s) => (
            <button key={s.id} className={`st-style ${style === s.id ? "on" : ""}`} onClick={() => setStyle(style === s.id ? "" : s.id)}>
              <span className="st-style-emoji">{s.emoji}</span>{s.label}
            </button>
          ))}
        </div>

        <div className="st-label">Prompt</div>
        <textarea className="st-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Describe the ${mode}…  (⌘↵ to generate)`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }} autoFocus />

        {error && <div className="st-error">{error}</div>}

        <button className="st-generate" onClick={generate} disabled={busy || !prompt.trim()}>
          {busy ? "GENERATING…" : "GENERATE"}
        </button>
      </aside>

      {/* ── RIGHT: immersive canvas ── */}
      <main className="st-canvas">
        <div className="st-stage">
          {busy && !latest && <div className="st-loading">Conjuring your {mode}…</div>}
          {!busy && !latest && <div className="st-hint">Your canvas awaits. Pick a style, write a prompt, hit <b>GENERATE</b>.</div>}
          {latest && (isVideo(latest)
            ? <video src={latest} controls autoPlay loop className="st-hero" />
            : <img src={latest} alt="" className="st-hero" />)}
        </div>
        {media.length > 1 && (
          <div className="st-carousel">
            {media.map((src, i) => (
              <button key={i} className={`st-thumb ${i === 0 ? "on" : ""}`} onClick={() => setMedia((m) => [src, ...m.filter((x) => x !== src)])}>
                {isVideo(src) ? <video src={src} muted /> : <img src={src} alt="" />}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
