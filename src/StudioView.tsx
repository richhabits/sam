import { useState } from "react";

// 🎨 SAM Studio — a real creative studio (Higgsfield-style), free & on-brand.
// Visual style cards with LIVE preview images (free Pollinations), cinematic camera-motion
// presets for video, aspect ratios, prompt-enhance, variations. Routes through SAM's free
// media matrix (/api/studio/*) — Pollinations → keyed lanes → fal/Novita — so it works with
// ZERO keys and never needs a paid MUAPI key.

const _pollinated = (q: string, seed: number) =>
  `https://image.pollinations.ai/prompt/${encodeURIComponent(q)}?width=220&height=150&nologo=true&seed=${seed}`;

const STYLES = [
  { id: "cinematic", label: "Cinematic", suffix: "cinematic, film grain, dramatic lighting, 35mm, shallow depth of field", pv: "cinematic portrait, dramatic rim lighting, film grain, moody" },
  { id: "photoreal", label: "Photoreal", suffix: "photorealistic, ultra-detailed, natural light, 8k", pv: "photorealistic landscape, golden hour, ultra detailed, 8k" },
  { id: "anime", label: "Anime", suffix: "anime style, cel-shaded, vibrant, studio quality", pv: "anime girl, cel shaded, vibrant colours, studio ghibli" },
  { id: "3d", label: "3D Render", suffix: "3D render, octane, soft global illumination, subsurface", pv: "cute 3d character render, octane, soft lighting, pixar" },
  { id: "product", label: "Product", suffix: "product photography, studio lighting, clean seamless background, crisp", pv: "luxury perfume bottle product shot, studio lighting, clean" },
  { id: "logo", label: "Logo / Vector", suffix: "clean vector logo, flat, minimal, high contrast, centered", pv: "minimal geometric vector logo mark, flat, bold" },
  { id: "neon", label: "Cyberpunk", suffix: "cyberpunk, neon, moody, volumetric fog, blade runner", pv: "cyberpunk city street, neon signs, rain, night, blade runner" },
  { id: "oil", label: "Oil Paint", suffix: "oil painting, thick visible brushstrokes, classical, rich colour", pv: "classical oil painting portrait, thick brushstrokes, renaissance" },
  { id: "water", label: "Watercolor", suffix: "watercolor painting, soft washes, delicate, paper texture", pv: "watercolour floral illustration, soft, delicate washes" },
  { id: "pixel", label: "Pixel Art", suffix: "pixel art, 16-bit, retro game, crisp pixels", pv: "16-bit pixel art fantasy village, retro game scene" },
  { id: "comic", label: "Comic", suffix: "comic book art, bold ink outlines, halftone, dynamic", pv: "comic book superhero, bold ink, halftone, dynamic action" },
  { id: "fantasy", label: "Fantasy", suffix: "epic fantasy, dramatic, magical, highly detailed, concept art", pv: "epic fantasy castle, dragons, magic, dramatic sky, concept art" },
];

// Cinematic camera moves (video) — Higgsfield's signature, done via prompt direction.
const MOTIONS = [
  { id: "", label: "Static", phrase: "" },
  { id: "push", label: "Push In", phrase: "camera slowly pushes in toward the subject" },
  { id: "pull", label: "Pull Out", phrase: "camera pulls back for a reveal" },
  { id: "orbit", label: "Orbit", phrase: "camera orbits 360 degrees around the subject" },
  { id: "pan", label: "Pan", phrase: "smooth cinematic camera pan across the scene" },
  { id: "crane", label: "Crane Up", phrase: "sweeping crane shot rising upward, aerial reveal" },
  { id: "fpv", label: "FPV Drone", phrase: "fast FPV drone flythrough, sweeping motion" },
  { id: "crash", label: "Crash Zoom", phrase: "sudden fast crash zoom in" },
  { id: "dolly", label: "Dolly", phrase: "dolly tracking shot following the subject" },
  { id: "handheld", label: "Handheld", phrase: "handheld camera, subtle natural shake, documentary" },
  { id: "tilt", label: "Tilt Up", phrase: "camera tilts slowly upward" },
  { id: "zoom", label: "Slow Zoom", phrase: "slow cinematic zoom" },
];

const RATIOS = [
  { id: "1:1", label: "1:1", w: 1024, h: 1024 },
  { id: "16:9", label: "16:9", w: 1280, h: 720 },
  { id: "9:16", label: "9:16", w: 720, h: 1280 },
  { id: "4:3", label: "4:3", w: 1024, h: 768 },
  { id: "3:2", label: "3:2", w: 1200, h: 800 },
];

export default function StudioView() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"image" | "video">("image");
  const [style, setStyle] = useState("cinematic");
  const [motion, setMotion] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [media, setMedia] = useState<string[]>([]);
  const [error, setError] = useState("");

  const buildPrompt = () => {
    const s = STYLES.find((x) => x.id === style)?.suffix;
    const m = mode === "video" ? MOTIONS.find((x) => x.id === motion)?.phrase : "";
    return [prompt.trim(), s, m].filter(Boolean).join(", ");
  };

  async function enhance() {
    if (!prompt.trim() || enhancing) return;
    setEnhancing(true);
    try { const r = await fetch("/api/studio/enhance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: prompt.trim() }) }).then((x) => x.json()); if (r.prompt) setPrompt(r.prompt); } catch {}
    setEnhancing(false);
  }

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError("");
    const full = buildPrompt();
    const r = RATIOS.find((x) => x.id === ratio)!;
    try {
      if (mode === "video") {
        const d = await fetch("/api/studio/video", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: full }) }).then((x) => x.json());
        if (d.url) setMedia((g) => [d.url, ...g]); else setError(d.error || "Couldn't generate the video — add a free fal/Novita key in Settings for video.");
      } else {
        const n = Math.min(4, Math.max(1, count));
        const reqs = Array.from({ length: n }, () => fetch("/api/studio/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: full, width: r.w, height: r.h }) }).then((x) => x.json()));
        const results = await Promise.all(reqs);
        const urls = results.map((d) => d.url).filter(Boolean);
        if (urls.length) setMedia((g) => [...urls, ...g]); else setError(results[0]?.error || "Couldn't generate — check your connection.");
      }
    } catch (e: any) { setError("Studio backend unreachable: " + (e?.message || e)); }
    finally { setBusy(false); }
  }

  const isVideo = (src: string) => /\.(mp4|webm|mov)(\?|$)/i.test(src);
  const latest = media[0];

  return (
    <div className="studio">
      {/* ── LEFT: command center ── */}
      <aside className="stu-panel">
        <div className="stu-brand">🎨 SAM <b>Studio</b></div>

        <div className="stu-seg">
          <button className={mode === "image" ? "on" : ""} onClick={() => setMode("image")}>🖼 Image</button>
          <button className={mode === "video" ? "on" : ""} onClick={() => setMode("video")}>🎬 Video</button>
        </div>

        <div className="stu-label">Style</div>
        <div className="stu-styles">
          {STYLES.map((s, _i) => (
            <button key={s.id} className={`stu-style ${style === s.id ? "on" : ""}`} onClick={() => setStyle(s.id)}
              style={{ backgroundImage: `url(/api/studio/preview/${s.id})` }} title={s.label}>
              <span className="stu-style-label">{s.label}</span>
            </button>
          ))}
        </div>

        {mode === "video" && (<>
          <div className="stu-label">🎥 Camera motion</div>
          <div className="stu-motions">
            {MOTIONS.map((m) => (
              <button key={m.id || "static"} className={`stu-chip ${motion === m.id ? "on" : ""}`} onClick={() => setMotion(m.id)}>{m.label}</button>
            ))}
          </div>
        </>)}

        <div className="stu-row2">
          <div style={{ flex: 1 }}>
            <div className="stu-label">Ratio</div>
            <div className="stu-motions">{RATIOS.map((r) => <button key={r.id} className={`stu-chip ${ratio === r.id ? "on" : ""}`} onClick={() => setRatio(r.id)}>{r.label}</button>)}</div>
          </div>
          {mode === "image" && (
            <div>
              <div className="stu-label">Count</div>
              <div className="stu-motions">{[1, 2, 4].map((n) => <button key={n} className={`stu-chip ${count === n ? "on" : ""}`} onClick={() => setCount(n)}>{n}</button>)}</div>
            </div>
          )}
        </div>

        <div className="stu-label">Prompt</div>
        <textarea className="stu-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Describe your ${mode}…  (⌘↵ to generate)`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }} autoFocus />
        <button className="stu-enhance" onClick={enhance} disabled={!prompt.trim() || enhancing}>{enhancing ? "✨ Enhancing…" : "✨ Enhance my prompt"}</button>

        {error && <div className="stu-error">{error}</div>}

        <button className="stu-generate" onClick={generate} disabled={busy || !prompt.trim()}>
          {busy ? (mode === "video" ? "🎬 Filming… (~1-2 min)" : "🎨 Generating…") : `Generate ${mode === "video" ? "video" : count > 1 ? count + " images" : "image"}`}
        </button>
      </aside>

      {/* ── RIGHT: immersive canvas ── */}
      <main className="stu-canvas">
        <div className="stu-stage">
          {busy && !latest && <div className="stu-hint">{mode === "video" ? "Filming your shot — a minute or two…" : "Painting your image…"}</div>}
          {!busy && !latest && <div className="stu-hint">Pick a <b>style</b>, write a prompt, hit <b>Generate</b>.<br /><span style={{ opacity: .6 }}>Free — no keys needed. Add a fal/Novita key for video.</span></div>}
          {latest && (isVideo(latest)
            ? <video src={latest} controls autoPlay loop className="stu-hero" />
            : <img src={latest} alt="" className="stu-hero" />)}
          {latest && <a className="stu-dl" href={latest} download target="_blank" rel="noreferrer" title="Download">⬇︎</a>}
        </div>
        {media.length > 1 && (
          <div className="stu-carousel">
            {media.map((src, i) => (
              <button key={i} className={`stu-thumb ${i === 0 ? "on" : ""}`} onClick={() => setMedia((m) => [src, ...m.filter((x) => x !== src)])}>
                {isVideo(src) ? <video src={src} muted /> : <img src={src} alt="" />}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
