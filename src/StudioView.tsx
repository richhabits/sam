import { useCallback, useEffect, useMemo, useState } from "react";
import Icon, { type IconName } from "./Icon";
import { queueStudioJob } from "./lib/api";

type Mode = "image" | "video" | "motion" | "speak" | "canvas";
type Kind = "image" | "video";

type Style = { id: string; label: string; category: string; cue: string };
type Rig = { id: string; label: string; description?: string };
type Aspect = { id: string; label: string; css: string; w: number; h: number };
type Generation = {
  id: string;
  url: string;
  kind: Kind;
  prompt: string;
  mode: Mode;
  style: string;
  at: number;
};

const STYLES: Style[] = [
  { id: "dusk", label: "Anamorphic Dusk", category: "cinematic", cue: "warm anamorphic lens flare, twilight dusk" },
  { id: "cyber", label: "Cyberpunk Neon", category: "neon", cue: "neon reflections, wet asphalt, dark futuristic" },
  { id: "noir", label: "Moody Noir", category: "moody", cue: "high contrast chiaroscuro, deep dramatic shadows" },
  { id: "photoreal", label: "Photoreal 8K", category: "cinematic", cue: "ultra-detailed, realistic global illumination" },
  { id: "golden", label: "Golden Hour", category: "cinematic", cue: "warm sunlight haze, soft rim lighting" },
  { id: "cinematic", label: "35mm Kodak", category: "cinematic", cue: "35mm film grain, cinematic depth of field" },
  { id: "3d", label: "3D Octane", category: "artistic", cue: "octane render, soft volumetric lighting, pixar style" },
  { id: "anime", label: "Anime Cel", category: "artistic", cue: "cel shaded, vibrant palette, studio ghibli" },
  { id: "neon", label: "Synthwave", category: "neon", cue: "vibrant neon glow, magenta and cyan beams" },
  { id: "vapor", label: "Vaporwave", category: "artistic", cue: "retro chrome grid, pastel sunset" },
  { id: "clay", label: "Claymation", category: "artistic", cue: "stop-motion plasticine, tactile texture" },
  { id: "product", label: "Luxury Studio", category: "cinematic", cue: "clean studio commercial lighting, macro lens" },
];

const FALLBACK_RIGS: Rig[] = [
  { id: "dolly_in_rapid", label: "Dolly in", description: "Push toward the subject" },
  { id: "dolly_out_epic", label: "Dolly out", description: "Pull back and reveal" },
  { id: "steadicam_tracking", label: "Steadicam", description: "Smooth follow" },
  { id: "orbit_360_cw", label: "360° orbit", description: "Wrap around" },
  { id: "crane_pedestal_up", label: "Crane rise", description: "Hero pedestal" },
  { id: "fpv_drone_dive", label: "FPV dive", description: "High-speed fly-through" },
  { id: "vertigo_hitchcock", label: "Vertigo", description: "Dolly zoom" },
  { id: "bullet_time_freeze", label: "Bullet time", description: "Frozen orbit" },
];

const ASPECTS: Aspect[] = [
  { id: "1:1", label: "1:1", css: "1 / 1", w: 1024, h: 1024 },
  { id: "16:9", label: "16:9", css: "16 / 9", w: 1280, h: 720 },
  { id: "9:16", label: "9:16", css: "9 / 16", w: 720, h: 1280 },
  { id: "4:5", label: "4:5", css: "4 / 5", w: 1024, h: 1280 },
];

const MODES: { id: Mode; label: string; icon: IconName; blurb: string; placeholder: string }[] = [
  { id: "image", label: "Image", icon: "studio", blurb: "A still, free first", placeholder: "A cinematic still of…" },
  { id: "video", label: "Video", icon: "video", blurb: "A short shot", placeholder: "A short cinematic shot of…" },
  { id: "motion", label: "Motion", icon: "camera", blurb: "Camera move on a shot", placeholder: "Subject and setting for the camera to move through…" },
  { id: "speak", label: "Speak", icon: "voice", blurb: "Talking-head from lines", placeholder: "Who is on camera, and the room they are in…" },
  { id: "canvas", label: "Canvas", icon: "frame", blurb: "Redraw a still", placeholder: "What should change in this still…" },
];

const EXAMPLES: Record<Mode, string[]> = {
  image: ["Neon alley at dusk, wet asphalt", "Luxury watch on black velvet", "Portrait in golden hour window light"],
  video: ["Hypercar drifting through rain", "Steam rising off a coffee cup, macro", "City drone sweep at blue hour"],
  motion: ["Orbit a chrome motorcycle at night", "Dolly in on a chess endgame", "Crane rise over a coastal highway"],
  speak: ["A film director in a quiet screening room", "A chef at a steel pass, late service", "A radio host in a warm booth"],
  canvas: ["Make the sky storm-dark", "Turn it into golden hour", "Same frame, winter and snow"],
};

const HISTORY_KEY = "sam.studio.history";
const GOLD = "#D9A05B";
const VIDEO_KEY_ERROR = "Could not encode a clip. Image still works free — tap Make a still.";

function loadHistory(): Generation[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter(isGeneration).slice(0, 40) : [];
  } catch {
    return [];
  }
}

function isGeneration(value: unknown): value is Generation {
  if (!value || typeof value !== "object") return false;
  const g = value as Record<string, unknown>;
  return typeof g.id === "string" && typeof g.url === "string" && (g.kind === "image" || g.kind === "video");
}

function isNativeDesktop(): boolean {
  return Boolean((globalThis as { samDesktop?: { isNative?: boolean } }).samDesktop?.isNative);
}

function isImageUrl(url: string): boolean {
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return false;
  if (/\/api\/studio\/media\/[^?]+\.mp4(\?|$)/i.test(url)) return false;
  return /\.(jpe?g|png|webp)(\?|$)/i.test(url) || url.startsWith("/api/studio/media/");
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await res.json();
    return data && typeof data === "object" ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export default function StudioView() {
  const native = isNativeDesktop();
  const [mode, setMode] = useState<Mode>("image");
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("dusk");
  const [styleCategory, setStyleCategory] = useState("ALL");
  const [aspectId, setAspectId] = useState("16:9");
  const [rigs, setRigs] = useState<Rig[]>(FALLBACK_RIGS);
  const [motion, setMotion] = useState(FALLBACK_RIGS[0]?.id ?? "dolly_in_rapid");
  const [intensity, setIntensity] = useState(60);
  const [transcript, setTranscript] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [history, setHistory] = useState<Generation[]>(loadHistory);
  const [activeId, setActiveId] = useState<string | null>(history[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stillOffer, setStillOffer] = useState<string | null>(null);
  const [deskQueue, setDeskQueue] = useState<{ id: string; concept: string; status: string }[]>([]);

  const aspect = ASPECTS.find((a) => a.id === aspectId) ?? ASPECTS.find((a) => a.id === "16:9") ?? {
    id: "16:9", label: "16:9", css: "16 / 9", w: 1280, h: 720,
  };
  const styleMeta = STYLES.find((s) => s.id === style) ?? STYLES.find((s) => s.id === "dusk") ?? STYLES[0]!;
  const active = history.find((g) => g.id === activeId) ?? history[0] ?? null;
  const modeMeta = MODES.find((m) => m.id === mode) ?? MODES[0]!;

  useEffect(() => {
    document.title = "Studio · SAM";
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 40)));
    } catch {
      /* private mode — history just will not persist */
    }
  }, [history]);

  useEffect(() => {
    fetch("/api/studio/presets/motion")
      .then((res) => res.json())
      .then((data: unknown) => {
        const cameras = data && typeof data === "object" ? (data as { cameras?: unknown }).cameras : null;
        if (!Array.isArray(cameras) || !cameras.length) return;
        const next: Rig[] = cameras.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const row = item as { id?: unknown; label?: unknown; description?: unknown };
          if (typeof row.id !== "string" || typeof row.label !== "string") return [];
          return [{ id: row.id, label: row.label, description: typeof row.description === "string" ? row.description : undefined }];
        });
        if (next.length) {
          setRigs(next);
          setMotion((id) => next.some((r) => r.id === id) ? id : next[0]?.id ?? id);
        }
      })
      .catch(() => {
        /* keep the built-in rigs that already match the server */
      });
  }, []);

  const filteredStyles = useMemo(
    () => STYLES.filter((s) => styleCategory === "ALL" || s.category === styleCategory.toLowerCase()),
    [styleCategory],
  );

  const back = () => {
    const sd = (globalThis as { samDesktop?: { close?: () => void } }).samDesktop;
    if (sd?.close) sd.close();
    else {
      window.close();
      setTimeout(() => { if (!window.closed) location.href = location.pathname; }, 50);
    }
  };

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote(null), 2800);
  };

  const remember = (gen: Generation) => {
    setHistory((prev) => {
      const next = [gen, ...prev.filter((g) => g.url !== gen.url)].slice(0, 40);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* private mode — strip still shows this session */ }
      return next;
    });
    setActiveId(gen.id);
  };

  const reuseActive = () => {
    if (!active) return;
    setPrompt(active.prompt);
    setMode(active.mode);
    setStyle(active.style);
    setError(null);
    setStillOffer(null);
  };

  const refineActive = () => {
    if (!active) return;
    setMode("canvas");
    setPrompt("");
    setActiveId(active.id);
    setError(null);
    setStillOffer(null);
  };

  const compilePrompt = useCallback(async (): Promise<string> => {
    const base = prompt.trim();
    const cue = styleMeta?.cue ? ` Style: ${styleMeta.cue}.` : "";
    const framed = `${base}${cue} Aspect ${aspect.id}.`;

    if (mode === "motion") {
      const res = await fetch("/api/studio/motion/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basePrompt: framed,
          cameraRigId: motion,
          motionIntensity: intensity / 50,
          aspectRatio: aspect.id,
        }),
      });
      const data = await readJson(res);
      if (typeof data.compiledPrompt === "string" && data.compiledPrompt.trim()) return data.compiledPrompt;
    }

    if (mode === "speak") {
      const res = await fetch("/api/studio/lipsync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: framed,
          speaker: speaker.trim() || "Speaker",
          transcript: transcript.trim(),
        }),
      });
      const data = await readJson(res);
      if (typeof data.lipSyncPrompt === "string" && data.lipSyncPrompt.trim()) return data.lipSyncPrompt;
    }

    if (mode === "canvas" && active?.prompt) {
      return `${framed} Keep the same subject and composition as: ${active.prompt}.`;
    }

    return framed;
  }, [prompt, styleMeta, aspect.id, mode, motion, intensity, speaker, transcript, active]);

  const generateStill = async (compiled: string): Promise<{ url?: string; error?: string }> => {
    const res = await fetch("/api/studio/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: compiled, width: aspect.w, height: aspect.h }),
    });
    const data = await readJson(res);
    return {
      url: typeof data.url === "string" ? data.url : undefined,
      error: typeof data.error === "string" ? data.error : undefined,
    };
  };

  const generateVideo = async (compiled: string, extra?: { stillUrl?: string; duration?: number; preferFree?: boolean }): Promise<{ url?: string; still?: string; error?: string }> => {
    const res = await fetch("/api/studio/video", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: compiled,
        width: aspect.w,
        height: aspect.h,
        motion,
        intensity: intensity / 50,
        audioText: mode === "speak" ? transcript.trim() : undefined,
        preferFree: extra?.preferFree ?? true,
        stillUrl: extra?.stillUrl,
        duration: extra?.duration,
      }),
    });
    const data = await readJson(res);
    return {
      url: typeof data.url === "string" ? data.url : undefined,
      still: typeof data.still === "string" ? data.still : undefined,
      error: typeof data.error === "string" ? data.error : undefined,
    };
  };

  const handleGenerate = async () => {
    if (busy) return;
    if (!prompt.trim()) {
      setError("Write what you want to see, then generate.");
      return;
    }
    if (mode === "speak" && !transcript.trim()) {
      setError("Speak needs the lines — type what they say.");
      return;
    }
    if (mode === "canvas" && !active) {
      setError("Canvas redraws a still. Generate an image first, or pick one from the strip.");
      return;
    }

    setBusy(true);
    setError(null);
    setStillOffer(null);
    setProgress(12);
    const tick = window.setInterval(() => setProgress((p) => (p < 88 ? p + 6 : p)), 500);

    try {
      const compiled = await compilePrompt();
      const wantsVideo = mode === "video" || mode === "motion" || mode === "speak";

      if (!wantsVideo) {
        const still = await generateStill(compiled);
        if (!still.url) {
          setError(still.error || "Could not make that still. Try again in a moment.");
          return;
        }
        remember({ id: `gen-${Date.now()}`, url: still.url, kind: "image", prompt: compiled, mode, style, at: Date.now() });
        setProgress(100);
        return;
      }

      // First paint: the still lands while the clip encodes — Antigravity, not a blank canvas.
      const still = await generateStill(compiled);
      if (still.url) {
        remember({ id: `gen-${Date.now()}`, url: still.url, kind: "image", prompt: compiled, mode, style, at: Date.now() });
        setProgress(48);
      }
      const clip = await generateVideo(compiled, { stillUrl: still.url, preferFree: true });
      if (!clip.url) {
        setError(clip.error || VIDEO_KEY_ERROR);
        setStillOffer(compiled);
        return;
      }
      remember({ id: `gen-${Date.now()}`, url: clip.url, kind: "video", prompt: compiled, mode, style, at: Date.now() });
      queueStudioJob(prompt.trim(), style, false).catch(() => {
        /* queue is a desk record — the clip already landed */
      });
      setProgress(100);
      flash(mode === "speak" ? "Clip ready — press play." : "Clip ready.");
    } catch {
      setError("Could not reach SAM Studio. Is the app still running?");
    } finally {
      window.clearInterval(tick);
      setBusy(false);
    }
  };

  const makeStillInstead = async () => {
    if (!stillOffer || busy) return;
    setBusy(true);
    setError(null);
    setProgress(12);
    try {
      const still = await generateStill(stillOffer);
      if (!still.url) {
        setError(still.error || "Could not make that still. Try again in a moment.");
        return;
      }
      remember({
        id: `gen-${Date.now()}`,
        url: still.url,
        kind: "image",
        prompt: stillOffer,
        mode: "image",
        style,
        at: Date.now(),
      });
      setMode("image");
      setStillOffer(null);
      setProgress(100);
      flash("Still ready.");
    } catch {
      setError("Could not reach SAM Studio. Is the app still running?");
    } finally {
      setBusy(false);
    }
  };

  const enhance = async () => {
    if (!prompt.trim() || busy) return;
    try {
      const res = await fetch("/api/studio/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style, camera: mode === "motion" ? motion : undefined }),
      });
      const data = await readJson(res);
      if (typeof data.prompt === "string" && data.prompt.trim()) {
        setPrompt(data.prompt.trim());
        flash("Prompt sharpened.");
      }
    } catch {
      setError("Enhance is busy — try again in a moment.");
    }
  };

  const queueActive = async () => {
    const concept = prompt.trim() || active?.prompt || "";
    if (!concept || busy) return;
    try {
      const r = await queueStudioJob(concept, style, false);
      setDeskQueue((q) => [{ id: r.id, concept: r.concept, status: r.status }, ...q].slice(0, 8));
      flash("Queued — generating now.");
      await handleGenerate();
    } catch {
      setError("Could not queue that shot.");
    }
  };

  const varyActive = async () => {
    if (busy) return;
    const compiled = (active?.prompt || prompt).trim();
    if (!compiled) return;
    setBusy(true); setError(null); setProgress(18);
    try {
      const res = await fetch("/api/studio/vary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: compiled, width: aspect.w, height: aspect.h, motion, intensity: intensity / 50 }),
      });
      const data = await readJson(res);
      if (typeof data.url !== "string") { setError(typeof data.error === "string" ? data.error : "Variation missed."); return; }
      remember({ id: `gen-${Date.now()}`, url: data.url, kind: "video", prompt: compiled, mode: mode === "image" ? "video" : mode, style, at: Date.now() });
      flash("Variation ready.");
    } catch { setError("Could not reach SAM Studio."); }
    finally { setBusy(false); setProgress(100); }
  };

  const extendActive = async () => {
    if (busy || !active) return;
    setBusy(true); setError(null); setProgress(18);
    try {
      const res = await fetch("/api/studio/extend", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: active.prompt,
          stillUrl: active.kind === "image" ? active.url : undefined,
          width: aspect.w, height: aspect.h, motion, intensity: intensity / 50,
          duration: 8,
          audioText: mode === "speak" ? transcript.trim() : undefined,
        }),
      });
      const data = await readJson(res);
      if (typeof data.url !== "string") { setError(typeof data.error === "string" ? data.error : "Extend missed."); return; }
      remember({ id: `gen-${Date.now()}`, url: data.url, kind: "video", prompt: active.prompt, mode: active.mode === "image" ? "video" : active.mode, style, at: Date.now() });
      flash("Extended clip ready.");
    } catch { setError("Could not reach SAM Studio."); }
    finally { setBusy(false); setProgress(100); }
  };

  const lane = mode === "image" || mode === "canvas"
    ? "Stills · Pollinations free, then your keyed lanes"
    : "Clips · free camera-move lane, then your credit keys";

  const canGo = Boolean(prompt.trim()) && !busy && (mode !== "speak" || Boolean(transcript.trim())) && (mode !== "canvas" || Boolean(active));

  return (
    <div style={{
      background: "#0B0B0D", color: "#F3F4F6", height: "100vh", display: "flex", flexDirection: "column",
      fontFamily: "var(--sans, system-ui)", overflow: "hidden",
    }}>
      <header style={{
        height: 52, minHeight: 52, display: "flex", alignItems: "center", gap: 12,
        padding: native ? "0 16px 0 78px" : "0 16px",
        borderBottom: "1px solid #1E1E22", background: "#111114",
      }}>
        <button type="button" onClick={back} style={ghostBtn} aria-label="Back to chat">
          ← Chat
        </button>
        <div style={{ fontSize: 14, fontWeight: 750, letterSpacing: "-0.02em" }}>Studio</div>
        <div role="tablist" aria-label="Studio modes" style={{ display: "flex", gap: 4, marginLeft: 8, background: "#0B0B0D", border: "1px solid #242428", borderRadius: 10, padding: 3 }}>
          {MODES.map((m) => {
            const on = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={on}
                title={m.blurb}
                onClick={() => { setMode(m.id); setError(null); }}
                style={{
                  display: "flex", alignItems: "center", gap: 6, border: "none", cursor: "pointer",
                  borderRadius: 7, padding: "6px 10px", fontSize: 12.5, fontWeight: 700,
                  background: on ? "rgba(217,160,91,0.16)" : "transparent",
                  color: on ? GOLD : "#9CA3AF",
                }}
              >
                <Icon name={m.icon} size={13} /> {m.label}
              </button>
            );
          })}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11.5, color: "#8A909D" }}>{lane}</div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "280px 1fr", gap: 0 }}>
        <aside style={{
          borderRight: "1px solid #1E1E22", background: "#111114", padding: 14,
          display: "flex", flexDirection: "column", gap: 14, overflowY: "auto",
        }}>
          <section>
            <Label>Look</Label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
              {["ALL", "CINEMATIC", "NEON", "MOODY", "ARTISTIC"].map((cat) => (
                <button key={cat} type="button" onClick={() => setStyleCategory(cat)} style={{
                  fontSize: 10, fontWeight: 700, border: "none", cursor: "pointer", borderRadius: 4,
                  padding: "3px 6px",
                  background: styleCategory === cat ? GOLD : "#1A1A1E",
                  color: styleCategory === cat ? "#111" : "#9CA3AF",
                }}>{cat}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {filteredStyles.map((s) => {
                const on = style === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    style={{
                      textAlign: "left", cursor: "pointer", borderRadius: 8, padding: 6,
                      border: on ? `1px solid ${GOLD}` : "1px solid #2A2A2E",
                      background: on ? "rgba(217,160,91,0.10)" : "#0B0B0D",
                      display: "flex", gap: 6, alignItems: "center",
                    }}
                  >
                    <span style={{
                      width: 28, height: 28, borderRadius: 5, flexShrink: 0,
                      backgroundImage: `url(/api/studio/preview/${s.id})`, backgroundSize: "cover",
                      border: "1px solid #333",
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: on ? GOLD : "#E5E7EB", lineHeight: 1.2 }}>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <Label>Frame</Label>
            <div style={{ display: "flex", gap: 6 }}>
              {ASPECTS.map((a) => (
                <button key={a.id} type="button" onClick={() => setAspectId(a.id)} style={{
                  flex: 1, fontSize: 11, fontWeight: 700, cursor: "pointer", borderRadius: 7, padding: "7px 0",
                  border: aspectId === a.id ? `1px solid ${GOLD}` : "1px solid #2A2A2E",
                  background: aspectId === a.id ? "rgba(217,160,91,0.12)" : "#0B0B0D",
                  color: aspectId === a.id ? GOLD : "#9CA3AF",
                }}>{a.label}</button>
              ))}
            </div>
          </section>

          {mode === "motion" && (
            <section>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <Label>Camera move</Label>
                <span style={{ fontSize: 11, color: GOLD, fontWeight: 700 }}>{intensity}%</span>
              </div>
              <input
                type="range" min={10} max={100} value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                aria-label="Motion intensity"
                style={{ width: "100%", accentColor: GOLD }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                {rigs.map((r) => {
                  const on = motion === r.id;
                  return (
                    <button key={r.id} type="button" onClick={() => setMotion(r.id)} style={{
                      textAlign: "left", cursor: "pointer", borderRadius: 7, padding: "7px 8px",
                      border: on ? `1px solid ${GOLD}` : "1px solid #2A2A2E",
                      background: on ? "rgba(217,160,91,0.12)" : "#0B0B0D",
                      color: on ? GOLD : "#C4C8D0", fontSize: 11, fontWeight: 700,
                    }}>
                      {r.label}
                      {r.description && <div style={{ fontSize: 9, fontWeight: 500, color: on ? "#C58D46" : "#6B7280", marginTop: 2 }}>{r.description}</div>}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {mode === "speak" && (
            <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Label>Lines</Label>
              <input
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value)}
                placeholder="Who is speaking"
                style={field}
              />
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="What they say — this becomes the talking-head prompt"
                rows={4}
                style={{ ...field, resize: "vertical", minHeight: 84 }}
              />
            </section>
          )}

          {mode === "canvas" && (
            <p style={{ fontSize: 12, color: "#9CA3AF", lineHeight: 1.45, margin: 0 }}>
              Canvas redraws a new still from your note. It is not pixel inpainting — pick a generation, say what should change, generate.
            </p>
          )}
        </aside>

        <main style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, background: "#08080A" }}>
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 18, position: "relative" }}>
            <div style={{
              width: "min(100%, 980px)", aspectRatio: aspect.css, maxHeight: "100%",
              background: "#000", borderRadius: 12, border: "1px solid #242428", overflow: "hidden",
              position: "relative", boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            }}>
              {active ? (
                active.kind === "video" && !isImageUrl(active.url) ? (
                  <video src={active.url} controls autoPlay loop style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
                ) : (
                  <img src={active.url} alt={active.prompt} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />
                )
              ) : (
                <div style={{
                  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 14, padding: 28, textAlign: "center",
                }}>
                  <Icon name={modeMeta.icon} size={28} />
                  <div style={{ fontSize: 20, fontWeight: 750, letterSpacing: "-0.03em" }}>
                    {modeMeta.label} — {modeMeta.blurb}
                  </div>
                  <div style={{ fontSize: 13.5, color: "#9CA3AF", maxWidth: 440, lineHeight: 1.5 }}>
                    Pick a job, write it, generate. Image is free. Video, motion and speak encode a playable clip on the free camera-move lane — press play when it lands.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {EXAMPLES[mode].map((ex) => (
                      <button key={ex} type="button" onClick={() => { setPrompt(ex); setError(null); }} style={{
                        ...ghostBtn, background: "#141418", border: "1px solid #2A2A2E",
                      }}>{ex}</button>
                    ))}
                  </div>
                </div>
              )}

              {active && !busy && (
                <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 6 }}>
                  <button type="button" onClick={reuseActive} style={{ ...ghostBtn, background: "rgba(10,10,12,0.85)" }}>Reuse</button>
                  <button type="button" onClick={refineActive} style={{ ...ghostBtn, background: "rgba(10,10,12,0.85)" }}>Refine</button>
                  <button type="button" onClick={() => void varyActive()} style={{ ...ghostBtn, background: "rgba(10,10,12,0.85)" }}>Vary</button>
                  <button type="button" onClick={() => void extendActive()} style={{ ...ghostBtn, background: "rgba(10,10,12,0.85)" }}>Extend</button>
                </div>
              )}

              {busy && (
                <div style={{
                  position: "absolute", left: 16, right: 16, bottom: 16, height: 4,
                  background: "#222", borderRadius: 99, overflow: "hidden",
                }}>
                  <div style={{ width: `${progress}%`, height: "100%", background: GOLD, transition: "width 0.3s" }} />
                </div>
              )}
            </div>
          </div>

          <div style={{ padding: "0 18px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
            {deskQueue.length > 0 && (
              <div style={{ fontSize: 11.5, color: "#9CA3AF", display: "flex", gap: 8, flexWrap: "wrap" }}>
                {deskQueue.map((j) => (
                  <span key={j.id} style={{ border: "1px solid #2A2A2E", borderRadius: 999, padding: "2px 8px" }}>
                    {j.status} · {j.concept.slice(0, 28)}
                  </span>
                ))}
              </div>
            )}
            {(error || note) && (
              <div style={{
                fontSize: 12.5, padding: "8px 12px", borderRadius: 8,
                background: error ? "rgba(229,72,77,0.12)" : "rgba(217,160,91,0.12)",
                color: error ? "#F0A0A0" : GOLD, border: `1px solid ${error ? "#5A2222" : "#4A3A20"}`,
              }}>
                {error || note}
                {stillOffer && (
                  <div style={{ marginTop: 8 }}>
                    <button type="button" onClick={() => void makeStillInstead()} disabled={busy} style={ghostBtn}>
                      Make a still
                    </button>
                  </div>
                )}
              </div>
            )}
            <div style={{
              display: "flex", gap: 8, alignItems: "flex-end",
              background: "#111114", border: "1px solid #242428", borderRadius: 14, padding: 10,
            }}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleGenerate();
                  }
                }}
                placeholder={modeMeta.placeholder}
                rows={2}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#F3F4F6", fontSize: 14.5, resize: "none", lineHeight: 1.45, minHeight: 52,
                }}
              />
              <button type="button" onClick={() => void queueActive()} disabled={!prompt.trim() || busy} style={ghostBtn}>Queue</button>
              <button type="button" onClick={() => void enhance()} disabled={!prompt.trim() || busy} style={ghostBtn}>
                <Icon name="sparkle" size={13} /> Enhance
              </button>
              <button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!canGo}
                style={{
                  background: canGo ? `linear-gradient(135deg, #EDBE7D 0%, ${GOLD} 100%)` : "#2A2A2E",
                  color: canGo ? "#111" : "#6B7280", border: "none", borderRadius: 10,
                  padding: "10px 16px", fontSize: 13, fontWeight: 800, cursor: canGo ? "pointer" : "default",
                  display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
                }}
              >
                <Icon name="sparkle" size={14} /> {busy ? "Making…" : "Generate"}
              </button>
            </div>
          </div>

          <div style={{
            height: 104, minHeight: 104, borderTop: "1px solid #1E1E22", background: "#111114",
            padding: "10px 14px", display: "flex", gap: 8, overflowX: "auto", alignItems: "stretch",
          }}>
            {!history.length ? (
              <div style={{ color: "#6B7280", fontSize: 12.5, alignSelf: "center", paddingLeft: 4 }}>
                Generations land here. Image is the fastest first paint.
              </div>
            ) : history.map((g) => {
              const on = g.id === active?.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setActiveId(g.id);
                    setPrompt(g.prompt);
                    setMode(g.mode);
                    setStyle(g.style);
                    setError(null);
                    setStillOffer(null);
                  }}
                  title={g.prompt}
                  style={{
                    width: 120, flexShrink: 0, borderRadius: 8, overflow: "hidden", cursor: "pointer",
                    border: on ? `2px solid ${GOLD}` : "1px solid #2A2A2E", padding: 0, background: "#000",
                    position: "relative",
                  }}
                >
                  {g.kind === "video" && !isImageUrl(g.url) ? (
                    <video src={g.url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <img src={g.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                  <span style={{
                    position: "absolute", left: 4, bottom: 4, fontSize: 9, fontWeight: 800,
                    background: "rgba(0,0,0,0.7)", color: GOLD, padding: "1px 5px", borderRadius: 4,
                    textTransform: "uppercase",
                  }}>{g.mode}</span>
                </button>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}

function Label({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8A909D", marginBottom: 8 }}>
      {children}
    </div>
  );
}

const ghostBtn: React.CSSProperties = {
  background: "transparent", color: "#D1D5DB", border: "1px solid #2A2A2E", borderRadius: 8,
  padding: "6px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "#0B0B0D", border: "1px solid #2A2A2E",
  borderRadius: 8, padding: "8px 10px", color: "#F3F4F6", fontSize: 12.5, outline: "none",
};
