import { useState } from "react";

// 🎨 SAM Studio — the Creative Space. A lean generation surface: type a prompt,
// SAM proxies it (keys hidden) to whatever image provider you've configured, and
// shows the result. Degrades honestly when no provider key is set. Opened either
// as a dedicated Electron window (?app=studio) or a browser tab.
const EXAMPLES = [
  "A cinematic wide shot of a lone lighthouse in a storm, moody, film grain",
  "Minimal logo for a coffee brand called 'Ember', warm, vector",
  "Isometric 3D bedroom, cozy, soft light, pastel palette",
  "Product shot of a matte-black smartwatch on marble, studio lighting",
];

export default function StudioView() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"image" | "video">("image");
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true); setError("");
    try {
      // Routes through SAM's /api/creative/* proxy (keys injected server-side).
      const path = mode === "video" ? "videos/generations" : "images/generations";
      const r = await fetch(`/api/creative/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, n: 1 }),
      });
      if (r.status === 503) { setError("🔑 Studio needs an image key. Add MUAPI_API_KEY (or a free HuggingFace / SiliconFlow key) in Admin → API keys, then try again."); return; }
      const d = await r.json().catch(() => ({}));
      // Accept the common response shapes so it works across providers.
      const urls: string[] = (
        d?.data?.map((x: any) => x.url || (x.b64_json && `data:image/png;base64,${x.b64_json}`)) ||
        d?.images || (d?.url ? [d.url] : [])
      ).filter(Boolean);
      if (urls.length) setImages((g) => [...urls, ...g]);
      else setError("The provider replied, but not with an image I recognised — check the key/endpoint for your provider.");
    } catch (e: any) {
      setError("Couldn't reach the Studio backend: " + (e?.message || e));
    } finally { setBusy(false); }
  }

  return (
    <div className="studio">
      <header className="studio-bar">
        <div className="studio-brand">🎨 SAM <b>Studio</b></div>
        <div className="studio-sub">Create images & video — keys hidden by SAM's proxy, free-first.</div>
      </header>
      <div className="studio-modes">
        <button className={mode === "image" ? "on" : ""} onClick={() => setMode("image")}>🖼️ Image</button>
        <button className={mode === "video" ? "on" : ""} onClick={() => setMode("video")}>🎬 Video</button>
      </div>
      <div className="studio-compose">
        <textarea className="studio-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Describe the ${mode} to create…  (⌘↵ to generate)`} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }} autoFocus />
        <button className="studio-go" onClick={generate} disabled={busy || !prompt.trim()}>{busy ? "Generating…" : "Generate"}</button>
      </div>
      {images.length === 0 && !busy && (
        <div className="studio-chips">{EXAMPLES.map((ex) => (
          <button key={ex} className="studio-chip" onClick={() => setPrompt(ex)}>{ex}</button>
        ))}</div>
      )}
      {error && <div className="studio-error">{error}</div>}
      <div className="studio-gallery">
        {images.length === 0 && !busy && <div className="studio-empty">Your creations will appear here.</div>}
        {busy && <div className="studio-skeleton" />}
        {images.map((src, i) => (/\.(mp4|webm|mov)(\?|$)/i.test(src)
          ? <video key={i} src={src} controls className="studio-img" />
          : <img key={i} src={src} alt="generated" className="studio-img" />))}
      </div>
    </div>
  );
}
