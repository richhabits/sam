import { useCallback, useEffect, useRef, useState } from "react";

// 🎨 SAM Studio — a real creative studio (Higgsfield-style), free & on-brand.
// Visual style cards with LIVE preview images (free Pollinations), cinematic camera-motion
// presets for video, aspect ratios, prompt-enhance, variations. Routes through SAM's free
// media matrix (/api/studio/*) — Pollinations → keyed lanes → fal/Novita — so it works with
// ZERO keys and never needs a paid MUAPI key.
//
// Every result carries the settings that MADE it (prompt, style, motion, ratio), so the gallery
// is a working history you can re-run and tweak — not just a strip of orphaned pictures. The
// gallery survives a reload via localStorage. Those URLs are usually same-origin
// /api/studio/media/… — which the server keeps only for the 60 most-recent generations, so a
// stored entry CAN outlive its file — and are occasionally a raw provider URL (the server falls
// back to one when it can't cache the bytes). Either way a dead URL self-prunes on the image's
// error event rather than sitting there as a broken tile.

// NOTE: the preview thumbnail for each style is generated server-side from a prompt in
// STUDIO_PREVIEWS (server/routes.studio.ts). Every id here MUST exist there or the card renders
// blank — server/studio.previews.test.ts holds that parity.
const STYLES = [
  { id: "cinematic", label: "Cinematic", suffix: "cinematic, film grain, dramatic lighting, 35mm, shallow depth of field" },
  { id: "photoreal", label: "Photoreal", suffix: "photorealistic, ultra-detailed, natural light, 8k" },
  { id: "anime", label: "Anime", suffix: "anime style, cel-shaded, vibrant, studio quality" },
  { id: "3d", label: "3D Render", suffix: "3D render, octane, soft global illumination, subsurface" },
  { id: "product", label: "Product", suffix: "product photography, studio lighting, clean seamless background, crisp" },
  { id: "logo", label: "Logo / Vector", suffix: "clean vector logo, flat, minimal, high contrast, centered" },
  { id: "neon", label: "Cyberpunk", suffix: "cyberpunk, neon, moody, volumetric fog, blade runner" },
  { id: "oil", label: "Oil Paint", suffix: "oil painting, thick visible brushstrokes, classical, rich colour" },
  { id: "water", label: "Watercolor", suffix: "watercolor painting, soft washes, delicate, paper texture" },
  { id: "pixel", label: "Pixel Art", suffix: "pixel art, 16-bit, retro game, crisp pixels" },
  { id: "comic", label: "Comic", suffix: "comic book art, bold ink outlines, halftone, dynamic" },
  { id: "fantasy", label: "Fantasy", suffix: "epic fantasy, dramatic, magical, highly detailed, concept art" },
  { id: "lineart", label: "Line Art", suffix: "clean line art, minimal single-weight strokes, black on white, no shading" },
  { id: "vapor", label: "Vaporwave", suffix: "vaporwave, 80s retro, neon pastel gradients, chrome, glitch grid" },
  { id: "clay", label: "Claymation", suffix: "claymation, stop-motion, handmade plasticine, soft studio light, fingerprint texture" },
  { id: "blueprint", label: "Blueprint", suffix: "technical blueprint, white schematic lines on blue, precise, annotated, drafting" },
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
  { id: "whip", label: "Whip Pan", phrase: "fast blurred whip pan to the next shot" },
  { id: "bullet", label: "Bullet Time", phrase: "frozen-moment camera arc around the subject" },
  { id: "dutch", label: "Dutch Angle", phrase: "tilted tense canted framing, unsettling angle" },
  { id: "boom", label: "Boom Down", phrase: "camera booms downward toward the subject" },
];

// `phrase` is how the ratio reaches VIDEO: /api/studio/video takes a prompt and nothing else, so
// width/height would be silently dropped and the ratio chips would be a lie. Saying it in the
// prompt is the only handle the video lanes actually give us.
const RATIOS = [
  { id: "1:1", label: "1:1", w: 1024, h: 1024, phrase: "square 1:1 framing" },
  { id: "16:9", label: "16:9", w: 1280, h: 720, phrase: "widescreen 16:9 cinematic framing" },
  { id: "9:16", label: "9:16", w: 720, h: 1280, phrase: "vertical 9:16 framing" },
  { id: "4:3", label: "4:3", w: 1024, h: 768, phrase: "4:3 framing" },
  { id: "3:2", label: "3:2", w: 1200, h: 800, phrase: "3:2 framing" },
];

type Mode = "image" | "video";
/** A finished generation plus the exact settings that made it — so it can be re-run or tweaked. */
type Item = { id: string; url: string; kind: Mode; prompt: string; style: string; motion: string; ratio: string; at: number };
/** One generation request. Held as a value so "re-run" and "generate" are the same code path. */
type Spec = { prompt: string; style: string; motion: string; ratio: string; mode: Mode; n: number };

const GALLERY_KEY = "sam.studio.gallery";
const GALLERY_MAX = 40;

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function loadGallery(): Item[] {
  try {
    const raw = JSON.parse(localStorage.getItem(GALLERY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((x) => x && typeof x.url === "string" && typeof x.id === "string")
      .slice(0, GALLERY_MAX)
      .map((x) => ({ ...x, kind: x.kind === "video" ? "video" : "image" }) as Item);
  } catch {
    return [];   // corrupt/absent storage is not an error worth showing anyone
  }
}

/** Provider errors arrive as raw tool output (sometimes markdown, sometimes very long). */
function tidyError(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").replace(/!?\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (!s) return fallback;
  return s.length > 260 ? `${s.slice(0, 257)}…` : s;
}

export default function StudioView() {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>("image");
  const [style, setStyle] = useState("cinematic");
  const [motion, setMotion] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [count, setCount] = useState(1);
  const [pending, setPending] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [enhancing, setEnhancing] = useState(false);
  const [items, setItems] = useState<Item[]>(loadGallery);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const busy = pending > 0;

  useEffect(() => {
    try { localStorage.setItem(GALLERY_KEY, JSON.stringify(items.slice(0, GALLERY_MAX))); }
    catch { /* quota/private-mode — the in-memory gallery still works, so this is not worth a warning */ }
  }, [items]);

  // Elapsed counter: a generation can take a minute+, and a button that just says "Generating…"
  // for 90 seconds is indistinguishable from a hang.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const toast = useCallback((msg: string) => {
    setNote(msg);
    setTimeout(() => setNote((n) => (n === msg ? "" : n)), 2200);
  }, []);

  const buildPrompt = (s: Spec) => {
    const styleSuffix = STYLES.find((x) => x.id === s.style)?.suffix;
    const motionPhrase = s.mode === "video" ? MOTIONS.find((x) => x.id === s.motion)?.phrase : "";
    const ratioPhrase = s.mode === "video" ? RATIOS.find((x) => x.id === s.ratio)?.phrase : "";
    return [s.prompt.trim(), styleSuffix, motionPhrase, ratioPhrase].filter(Boolean).join(", ");
  };

  async function enhance() {
    const base = prompt.trim();
    if (!base || enhancing) return;
    setEnhancing(true);
    setError("");
    try {
      const r = await fetch("/api/studio/enhance", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: base }),
      }).then((x) => x.json());
      // The endpoint echoes the prompt back unchanged when no model answered. Silently doing
      // nothing looks like a broken button, so say what happened.
      if (r.prompt && r.prompt !== base) { setPrompt(r.prompt); toast("Prompt enhanced"); }
      else setError("Enhance couldn't reach a model just now — your prompt is unchanged. Generating still works.");
    } catch (e) {
      setError(`Enhance failed: ${tidyError((e as Error)?.message, "the Studio backend is unreachable")}`);
    }
    setEnhancing(false);
  }

  /** Single code path for Generate, Re-run and Variations. Results land ONE AT A TIME. */
  async function run(spec: Spec) {
    if (!spec.prompt.trim() || busy) return;
    const full = buildPrompt(spec);
    const r = RATIOS.find((x) => x.id === spec.ratio) ?? RATIOS[0];
    const n = spec.mode === "video" ? 1 : Math.min(4, Math.max(1, spec.n));
    const ctl = new AbortController();
    abortRef.current = ctl;
    setError("");
    setElapsed(0);
    setPending(n);

    const fails: string[] = [];
    const one = async () => {
      const url = spec.mode === "video" ? "/api/studio/video" : "/api/studio/image";
      const body = spec.mode === "video" ? { prompt: full } : { prompt: full, width: r.w, height: r.h };
      try {
        const d = await fetch(url, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal,
        }).then((x) => x.json());
        if (d?.url) {
          const item: Item = { id: newId(), url: d.url, kind: spec.mode, prompt: spec.prompt.trim(), style: spec.style, motion: spec.motion, ratio: spec.ratio, at: Date.now() };
          // Newest first, and keep the newest selected so you watch results arrive.
          setItems((g) => [item, ...g].slice(0, GALLERY_MAX));
          setSelected(0);
        } else {
          fails.push(tidyError(d?.error, spec.mode === "video"
            ? "No video lane answered — add a free fal.ai, Novita or SiliconFlow key in Settings for video."
            : "No image lane answered — check your connection."));
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        fails.push(tidyError((e as Error)?.message, "Studio backend unreachable"));
      } finally {
        setPending((p) => Math.max(0, p - 1));
      }
    };

    await Promise.all(Array.from({ length: n }, one));
    abortRef.current = null;
    if (ctl.signal.aborted) return;
    // Partial failure used to be invisible: ask for 4, get 1, no explanation. Say so.
    if (fails.length) {
      setError(fails.length < n ? `${fails.length} of ${n} didn't come back — ${fails[0]}` : fails[0]);
    }
  }

  const currentSpec = (): Spec => ({ prompt, style, motion, ratio, mode, n: count });

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(0);
    setError("Stopped waiting. The provider may still finish in the background.");
  }

  const item = items[selected];

  /** Load a result's settings back into the controls so you can tweak and go again. */
  function reuse(it: Item) {
    setPrompt(it.prompt);
    setStyle(it.style);
    setMotion(it.motion);
    setRatio(it.ratio);
    setMode(it.kind);
    toast("Settings loaded — tweak and generate");
  }

  function remove(it: Item) {
    setItems((g) => g.filter((x) => x.id !== it.id));
    setSelected(0);
  }

  /**
   * Clipboard rejects image/jpeg, so re-encode to PNG through a canvas.
   *
   * The canvas can be TAINTED: /api/studio/image usually returns a same-origin
   * /api/studio/media/… URL, but when the vault cache can't fetch the bytes it falls back to
   * handing back the raw provider URL (observed: a direct image.pollinations.ai link). Reading
   * that canvas throws a SecurityError *inside the onload handler* — where a bare `resolve`
   * would never run and this await would hang forever. Hence the try/catch and the timeout:
   * every path must settle the promise so the fallback (copy the link) can happen.
   */
  async function copyImage(it: Item) {
    try {
      const png = await new Promise<Blob | null>((resolve) => {
        const done = (b: Blob | null) => resolve(b);
        const bail = setTimeout(() => done(null), 15000);
        const finish = (b: Blob | null) => { clearTimeout(bail); done(b); };
        const img = new Image();
        img.onload = () => {
          try {
            const c = document.createElement("canvas");
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            const ctx = c.getContext("2d");
            if (!ctx) return finish(null);
            ctx.drawImage(img, 0, 0);
            c.toBlob(finish, "image/png");   // throws SecurityError if cross-origin
          } catch { finish(null); }
        };
        img.onerror = () => finish(null);
        img.src = it.url;
      });
      if (!png) throw new Error("could not read the image");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast("Image copied");
    } catch {
      try { await navigator.clipboard.writeText(new URL(it.url, location.href).href); toast("Link copied instead"); }
      catch { toast("Couldn't copy"); }
    }
  }

  const modeLabel = mode === "video" ? "video" : count > 1 ? `${count} images` : "image";

  return (
    <div className="studio">
      {/* ── LEFT: command center ── */}
      <aside className="stu-panel">
        <div className="stu-brand">🎨 SAM <b>Studio</b></div>

        <div className="stu-seg">
          <button type="button" className={mode === "image" ? "on" : ""} onClick={() => setMode("image")}>🖼 Image</button>
          <button type="button" className={mode === "video" ? "on" : ""} onClick={() => setMode("video")}>🎬 Video</button>
        </div>

        <div className="stu-label">Style</div>
        <div className="stu-styles">
          {STYLES.map((s) => (
            <button type="button" key={s.id} className={`stu-style ${style === s.id ? "on" : ""}`} onClick={() => setStyle(s.id)}
              style={{ backgroundImage: `url(/api/studio/preview/${s.id})` }} title={s.suffix}>
              <span className="stu-style-label">{s.label}</span>
            </button>
          ))}
        </div>

        {mode === "video" && (<>
          <div className="stu-label">🎥 Camera motion</div>
          <div className="stu-motions">
            {MOTIONS.map((m) => (
              <button type="button" key={m.id || "static"} className={`stu-chip ${motion === m.id ? "on" : ""}`} onClick={() => setMotion(m.id)}>{m.label}</button>
            ))}
          </div>
        </>)}

        <div className="stu-row2">
          <div style={{ flex: 1 }}>
            <div className="stu-label">Ratio</div>
            <div className="stu-motions">{RATIOS.map((r) => <button type="button" key={r.id} className={`stu-chip ${ratio === r.id ? "on" : ""}`} onClick={() => setRatio(r.id)}>{r.label}</button>)}</div>
          </div>
          {mode === "image" && (
            <div>
              <div className="stu-label">Count</div>
              <div className="stu-motions">{[1, 2, 4].map((n) => <button type="button" key={n} className={`stu-chip ${count === n ? "on" : ""}`} onClick={() => setCount(n)}>{n}</button>)}</div>
            </div>
          )}
        </div>

        <div className="stu-label">Prompt</div>
        <textarea className="stu-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Describe your ${mode}…  (⌘↵ to generate)`}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(currentSpec()); }} autoFocus />
        <button type="button" className="stu-enhance" onClick={enhance} disabled={!prompt.trim() || enhancing}>{enhancing ? "✨ Enhancing…" : "✨ Enhance my prompt"}</button>

        {error && <div className="stu-error">{error}</div>}

        {busy ? (
          <div className="stu-running">
            <div className="stu-runline">
              <span className="stu-spin" />
              <span>{mode === "video" ? "Filming your shot" : `Generating${pending > 1 ? ` — ${pending} left` : ""}`}</span>
              <span className="stu-elapsed">{elapsed}s</span>
            </div>
            <button type="button" className="stu-stop" onClick={stop}>Stop waiting</button>
          </div>
        ) : (
          <button type="button" className="stu-generate" onClick={() => run(currentSpec())} disabled={!prompt.trim()}>
            Generate {modeLabel}
          </button>
        )}
      </aside>

      {/* ── RIGHT: immersive canvas ── */}
      <main className="stu-canvas">
        <div className="stu-stage">
          {busy && !item && <div className="stu-hint">{mode === "video" ? `Filming your shot — a minute or two… (${elapsed}s)` : `Painting your image… (${elapsed}s)`}</div>}
          {!busy && !item && <div className="stu-hint">Pick a <b>style</b>, write a prompt, hit <b>Generate</b>.<br /><span style={{ opacity: .6 }}>Free — no keys needed. Add a free fal/Novita key for video.</span></div>}
          {item && (item.kind === "video"
            ? <video key={item.id} src={item.url} controls autoPlay loop className="stu-hero" />
            // A gallery entry can outlive the server's 60-file cache — drop it rather than show a broken tile.
            : <img key={item.id} src={item.url} alt={item.prompt} className="stu-hero" onError={() => remove(item)} />)}
          {item && (
            <div className="stu-actions">
              <a className="stu-act" href={item.url} download target="_blank" rel="noreferrer" title="Download">⬇︎ Save</a>
              {item.kind === "image" && <button type="button" className="stu-act" onClick={() => copyImage(item)} title="Copy image to clipboard">⧉ Copy</button>}
              <button type="button" className="stu-act" onClick={() => reuse(item)} title="Load these settings into the panel to tweak">✎ Tweak</button>
              <button type="button" className="stu-act" onClick={() => run({ prompt: item.prompt, style: item.style, motion: item.motion, ratio: item.ratio, mode: item.kind, n: 1 })} disabled={busy} title="Generate another with the same settings">↻ Again</button>
              <button type="button" className="stu-act stu-act-del" onClick={() => remove(item)} title="Remove from gallery">✕</button>
            </div>
          )}
        </div>

        {item && (
          <div className="stu-meta" title={item.prompt}>
            <span className="stu-meta-tag">{STYLES.find((s) => s.id === item.style)?.label ?? item.style}</span>
            <span className="stu-meta-tag">{item.ratio}</span>
            {item.kind === "video" && item.motion && <span className="stu-meta-tag">{MOTIONS.find((m) => m.id === item.motion)?.label}</span>}
            <span className="stu-meta-prompt">{item.prompt}</span>
          </div>
        )}

        {(items.length > 1 || busy) && (
          <div className="stu-carousel">
            {/* Skeletons for in-flight results, so a batch of 4 shows what's still coming. */}
            {Array.from({ length: pending }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are identical and order-free
              <div key={`skel-${i}`} className="stu-skel" />
            ))}
            {items.map((it, i) => (
              <button type="button" key={it.id} className={`stu-thumb ${i === selected ? "on" : ""}`} onClick={() => setSelected(i)} title={it.prompt}>
                {it.kind === "video"
                  ? <video src={it.url} muted />
                  : <img src={it.url} alt="" onError={() => remove(it)} />}
              </button>
            ))}
          </div>
        )}
        {note && <div className="stu-toast">{note}</div>}
      </main>
    </div>
  );
}
