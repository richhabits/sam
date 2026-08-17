import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon";

// 🎨 SAM Studio Director — Pro Creative Filmmaking Suite (Runway Gen-3 / Higgsfield Pro)
// Complete with 4K Cinematic Player HUD, Camera Movement & Lens Selectors, Lighting Presets,
// Motion Intensity dials, Multi-track Storyboard Timeline, and Render Queue.

const STYLES = [
  { id: "cinematic", label: "Cinematic 35mm", desc: "Anamorphic Panavision, Kodak 5219 grain" },
  { id: "noir", label: "High Contrast Noir", desc: "Dramatic chiaroscuro, volumetric shadow" },
  { id: "dusk", label: "Cinematic Dusk", desc: "Golden hour haze, warm anamorphic flare" },
  { id: "cyber", label: "Cyberpunk Neon", desc: "Vibrant neon backlight, wet asphalt fog" },
  { id: "photoreal", label: "Photoreal 8K", desc: "Natural balanced daylight, ultra-sharp" },
  { id: "anime", label: "Anime Masterpiece", desc: "Makoto Shinkai aesthetic, vibrant sky" },
];

const MOTIONS = [
  { id: "dolly", label: "Dolly Track", icon: "camera", phrase: "smooth dolly tracking forward" },
  { id: "steadicam", label: "Steadicam", icon: "camera", phrase: "smooth cinematic steadicam follow" },
  { id: "orbit", label: "360° Orbit", icon: "refresh", phrase: "sweeping 360 degree orbit shot" },
  { id: "crane", label: "Crane Pedestal Up", icon: "arrow-up", phrase: "dramatic crane rising upward" },
  { id: "fpv", label: "FPV Drone Flythrough", icon: "zap", phrase: "fast dynamic FPV drone flyby" },
  { id: "pan", label: "Whip Pan", icon: "repeat", phrase: "fast smooth horizontal pan" },
];

const LENSES = [
  { id: "35mm", label: "Anamorphic 35mm T2.1", desc: "Classic cinematic widescreen bokeh" },
  { id: "50mm", label: "50mm Prime f/1.2", desc: "Natural human eye perspective" },
  { id: "85mm", label: "85mm Portrait f/1.4", desc: "Compressed background subject isolation" },
  { id: "16mm", label: "16mm Ultra-Wide", desc: "Expansive landscape & architectural scale" },
];

const ENGINES = [
  { id: "flux", label: "FLUX.1 Pro", badge: "Fast 4K" },
  { id: "higgsfield", label: "Higgsfield Motion v3", badge: "Pro Motion" },
  { id: "sora", label: "OpenAI Sora v2", badge: "Cinematic" },
  { id: "midjourney", label: "Midjourney v6.1", badge: "Artistic" },
];

type TimelineClip = { id: string; name: string; duration: string; type: "video" | "audio"; color: string; widthPct: number };

export default function StudioView() {
  const [prompt, setPrompt] = useState("Cinematic slow-motion shot of a futuristic cyberpunk explorer walking through neon rain in Neo-Tokyo, anamorphic lens flare, steam rising from grates.");
  const [motion, setMotion] = useState("crane");
  const [motionIntensity, setMotionIntensity] = useState(75);
  const [style, setStyle] = useState("cinematic");
  const [lens, setLens] = useState("35mm");
  const [engine, setEngine] = useState("higgsfield");
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState("00:01:24:18");
  const [fps, setFps] = useState("24 FPS");
  const [res, setRes] = useState("4K UHD");
  const [toast, setToast] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState(0);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleGenerate = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenProgress(10);
    triggerToast("🎬 Dispatching scene to render queue (Higgsfield Pro / FLUX 4K)...");

    const int = setInterval(() => {
      setGenProgress((p) => {
        if (p >= 100) {
          clearInterval(int);
          setIsGenerating(false);
          triggerToast("✓ Scene rendered successfully in 4K UHD 24fps!");
          return 100;
        }
        return p + 20;
      });
    }, 600);
  };

  const back = () => {
    const sd = (globalThis as any).samDesktop;
    if (sd?.close) {
      sd.close();
    } else {
      window.close();
      setTimeout(() => {
        if (!window.closed) location.href = "/";
      }, 50);
    }
  };

  const clips: TimelineClip[] = [
    { id: "c1", name: "Scene 1 · Street Entrance", duration: "0:04", type: "video", color: "#3B82F6", widthPct: 24 },
    { id: "c2", name: "Scene 2 · Crane Pedestal Reveal", duration: "0:08", type: "video", color: "#10B981", widthPct: 36 },
    { id: "c3", name: "Scene 3 · Cyber Neon Close-up", duration: "0:05", type: "video", color: "#F59E0B", widthPct: 28 },
  ];

  return (
    <div style={{
      background: "#090A0F",
      color: "#F3F4F6",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif",
      boxSizing: "border-box",
      userSelect: "none",
    }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: "linear-gradient(135deg, #FF7A3D, #EA580C)", color: "#fff",
          padding: "12px 20px", borderRadius: 12, fontWeight: 700, fontSize: 13,
          boxShadow: "0 10px 30px rgba(255,122,61,0.4)", display: "flex", alignItems: "center", gap: 8,
          animation: "slideInRight 0.25s ease-out",
        }}>
          <Icon name="sparkle" size={16} /> {toast}
        </div>
      )}

      {/* Top Header Bar */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid #1E2230", padding: "12px 20px", background: "#0E1017",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #FF7A3D, #A855F7)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900 }}>
              🎬
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "#fff", letterSpacing: "-.02em" }}>SAM STUDIO DIRECTOR</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#FF7A3D", letterSpacing: ".06em" }}>PRO CINEMATIC WORKSPACE</div>
            </div>
          </div>

          <div style={{ height: 24, width: 1, background: "#262B3D" }} />

          {/* Mode Switcher */}
          <div style={{ display: "flex", gap: 4, background: "#151824", border: "1px solid #262B3D", borderRadius: 10, padding: 3 }}>
            {["Director Deck", "Storyboard", "Batch Queue"].map((tab, idx) => (
              <button
                key={tab}
                type="button"
                style={{
                  background: idx === 0 ? "rgba(255,122,61,0.18)" : "transparent",
                  border: idx === 0 ? "1px solid #FF7A3D" : "1px solid transparent",
                  borderRadius: 7, padding: "5px 14px", color: idx === 0 ? "#FF9D6E" : "#9CA3AF",
                  fontWeight: 700, fontSize: 12, cursor: "pointer"
                }}>
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Right Action Cluster */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#151824", border: "1px solid #262B3D", borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 800, color: "#10B981" }}>
            <span>●</span> <span>{res} · {fps}</span>
          </div>
          <button
            type="button"
            onClick={() => triggerToast("✓ Project exported to Pro Res 422 HQ timeline.")}
            style={{
              background: "#1E2230", border: "1px solid #2D354D", borderRadius: 8,
              padding: "7px 14px", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
            Export Project ▾
          </button>
          <button
            type="button"
            onClick={back}
            style={{
              background: "#151824", border: "1px solid #262B3D", borderRadius: 8,
              padding: "7px 14px", color: "#9CA3AF", fontWeight: 700, fontSize: 12, cursor: "pointer",
            }}>
            ← Return to SAM
          </button>
        </div>
      </header>

      {/* Main 3-Column Studio Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr 320px",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}>
        {/* Left Column: AI Script & Prompt Director Deck */}
        <div style={{
          background: "#0E1017", borderRight: "1px solid #1E2230",
          padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto",
        }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase" }}>Scene Script &amp; Prompt</span>
              <button
                type="button"
                onClick={() => triggerToast("✓ Prompt optimized with cinematic camera and lighting parameters.")}
                style={{ background: "none", border: "none", color: "#FF7A3D", fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                <Icon name="sparkle" size={12} /> Auto-Enhance
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              style={{
                width: "100%", background: "#151824", border: "1px solid #262B3D", borderRadius: 10,
                padding: 10, color: "#fff", fontSize: 12.5, lineHeight: 1.5, resize: "none", outline: "none",
                boxSizing: "border-box", fontFamily: "inherit"
              }}
            />
          </div>

          {/* Camera Movement Selectors */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase", marginBottom: 8 }}>Camera Motion Presets</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {MOTIONS.map((m) => {
                const on = motion === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMotion(m.id)}
                    style={{
                      background: on ? "rgba(255,122,61,0.18)" : "#151824",
                      border: on ? "1px solid #FF7A3D" : "1px solid #262B3D",
                      borderRadius: 8, padding: "8px 10px", color: on ? "#FF9D6E" : "#D1D5DB",
                      fontWeight: 700, fontSize: 11.5, textAlign: "left", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 6,
                    }}>
                    <Icon name={m.icon as any} size={13} /> {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Motion Intensity Slider */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "#9CA3AF", marginBottom: 4 }}>
              <span>Motion Intensity / Velocity</span>
              <span style={{ color: "#FF7A3D" }}>{motionIntensity}%</span>
            </div>
            <input
              type="range" min="10" max="100" value={motionIntensity}
              onChange={(e) => setMotionIntensity(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#FF7A3D" }}
            />
          </div>

          {/* Lighting & Aesthetic Presets */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase", marginBottom: 8 }}>Lighting &amp; Aesthetic Presets</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {STYLES.map((s) => {
                const on = style === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    style={{
                      background: on ? "rgba(168,85,247,0.18)" : "#151824",
                      border: on ? "1px solid #A855F7" : "1px solid #262B3D",
                      borderRadius: 8, padding: "8px 10px", color: on ? "#D8B4FE" : "#D1D5DB",
                      fontWeight: 700, fontSize: 11.5, textAlign: "left", cursor: "pointer",
                    }}>
                    <div>{s.label}</div>
                    <div style={{ fontSize: 9.5, color: "#6B7280", fontWeight: 500, marginTop: 2 }}>{s.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lens Selection */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase", marginBottom: 8 }}>Cinema Lens Optics</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {LENSES.map((l) => {
                const on = lens === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setLens(l.id)}
                    style={{
                      background: on ? "rgba(16,185,129,0.15)" : "#151824",
                      border: on ? "1px solid #10B981" : "1px solid #262B3D",
                      borderRadius: 8, padding: "8px 10px", color: on ? "#6EE7B7" : "#9CA3AF",
                      fontWeight: 700, fontSize: 11.5, textAlign: "left", cursor: "pointer",
                      display: "flex", justifyContent: "space-between", alignItems: "center"
                    }}>
                    <span>{l.label}</span>
                    <span style={{ fontSize: 10, color: "#6B7280" }}>{l.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Center Column: 4K 16:9 Cinematic Video Player & HUD */}
        <div style={{
          display: "flex", flexDirection: "column", background: "#050608",
          padding: 16, gap: 14, overflow: "hidden",
        }}>
          {/* 16:9 Viewport */}
          <div style={{
            flex: 1, position: "relative", background: "#0D0E14",
            border: "1px solid #1E2230", borderRadius: 14, overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {/* Background Cyberpunk Scene Simulation */}
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(ellipse at center, rgba(168,85,247,0.25) 0%, rgba(255,122,61,0.15) 50%, #090A0F 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 42, marginBottom: 10, filter: "drop-shadow(0 0 20px rgba(255,122,61,0.6))" }}>🎬</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#fff", letterSpacing: "-.02em" }}>NEO-TOKYO CYBERPUNK 2088</div>
                <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>High Dynamic Range · 4K 24fps Master</div>
              </div>
            </div>

            {/* Top HUD Overlays */}
            <div style={{
              position: "absolute", top: 14, left: 16, right: 16,
              display: "flex", justifyContent: "space-between", alignItems: "center",
              fontSize: 11, fontWeight: 800, color: "#fff", textShadow: "0 2px 4px rgba(0,0,0,0.8)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ background: "#EF4444", color: "#fff", padding: "2px 6px", borderRadius: 4, fontSize: 10 }}>● REC</span>
                <span style={{ background: "rgba(0,0,0,0.6)", padding: "4px 8px", borderRadius: 6, backdropFilter: "blur(6px)" }}>{currentTime}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ background: "rgba(0,0,0,0.6)", padding: "4px 8px", borderRadius: 6, backdropFilter: "blur(6px)" }}>MOTION: {motion.toUpperCase()} ({motionIntensity}%)</span>
                <span style={{ background: "rgba(0,0,0,0.6)", padding: "4px 8px", borderRadius: 6, backdropFilter: "blur(6px)" }}>LENS: {lens.toUpperCase()}</span>
              </div>
            </div>

            {/* Center Grid Guides */}
            <div style={{
              position: "absolute", inset: 40, border: "1px dashed rgba(255,255,255,0.12)",
              pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <div style={{ width: 12, height: 12, borderTop: "2px solid #FF7A3D", borderLeft: "2px solid #FF7A3D" }} />
            </div>

            {/* Bottom HUD Audio Levels */}
            <div style={{
              position: "absolute", bottom: 14, right: 16,
              display: "flex", alignItems: "center", gap: 3, background: "rgba(0,0,0,0.6)",
              padding: "4px 8px", borderRadius: 6,
            }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "#9CA3AF", marginRight: 4 }}>CH1/2</span>
              {[60, 80, 45, 90, 75, 40, 65].map((h, i) => (
                <div key={i} style={{ width: 3, height: h / 5, background: h > 80 ? "#EF4444" : "#10B981", borderRadius: 1 }} />
              ))}
            </div>
          </div>

          {/* Transport Controls Bar */}
          <div style={{
            background: "#0E1017", border: "1px solid #1E2230", borderRadius: 10,
            padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                onClick={() => setIsPlaying(!isPlaying)}
                style={{
                  background: "linear-gradient(135deg, #FF7A3D, #EA580C)", border: "none",
                  borderRadius: "50%", width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#fff", cursor: "pointer", boxShadow: "0 2px 10px rgba(255,122,61,0.4)"
                }}>
                <Icon name={isPlaying ? "pause" : "play"} size={16} />
              </button>
              <button type="button" onClick={() => triggerToast("⏮ Skipped to start")} style={{ background: "none", border: "none", color: "#9CA3AF", cursor: "pointer" }}><Icon name="refresh" size={14} /></button>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#D1D5DB", fontFamily: "ui-monospace, monospace" }}>{currentTime} / 00:04:12:00</span>
            </div>

            <div style={{ flex: 1, margin: "0 20px" }}>
              <div style={{ height: 6, background: "#1E2230", borderRadius: 3, position: "relative", cursor: "pointer" }}>
                <div style={{ width: "34%", height: "100%", background: "#FF7A3D", borderRadius: 3 }} />
                <div style={{ position: "absolute", left: "34%", top: -4, width: 14, height: 14, borderRadius: "50%", background: "#fff", boxShadow: "0 0 8px rgba(0,0,0,0.5)" }} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "#9CA3AF" }}>
              <Icon name="sound" size={14} />
              <span>48 kHz 24-bit</span>
            </div>
          </div>
        </div>

        {/* Right Column: Generation Queue & Engine Selector */}
        <div style={{
          background: "#0E1017", borderLeft: "1px solid #1E2230",
          padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto",
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase", marginBottom: 8 }}>AI Video Engine</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {ENGINES.map((eng) => {
                const on = engine === eng.id;
                return (
                  <button
                    key={eng.id}
                    type="button"
                    onClick={() => setEngine(eng.id)}
                    style={{
                      background: on ? "rgba(255,122,61,0.15)" : "#151824",
                      border: on ? "1px solid #FF7A3D" : "1px solid #262B3D",
                      borderRadius: 8, padding: "8px 12px", color: on ? "#FF9D6E" : "#D1D5DB",
                      fontWeight: 700, fontSize: 12, textAlign: "left", cursor: "pointer",
                      display: "flex", justifyContent: "space-between", alignItems: "center"
                    }}>
                    <span>{eng.label}</span>
                    <span style={{ fontSize: 10, background: on ? "#FF7A3D" : "#262B3D", color: on ? "#000" : "#9CA3AF", padding: "2px 6px", borderRadius: 4, fontWeight: 800 }}>{eng.badge}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Render Queue */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 140 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase", marginBottom: 8 }}>Scene Render Queue</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1 }}>
              {[
                { name: "Scene 2 (Neo-Tokyo)", engine: "Higgsfield v3", status: "Complete", ok: true },
                { name: "Scene 3 (Crane Reveal)", engine: "OpenAI Sora", status: isGenerating ? `Rendering (${genProgress}%)` : "Complete", ok: !isGenerating },
                { name: "Scene 4 (Wet Alley)", engine: "FLUX.1 Pro", status: "Queued", ok: false },
              ].map((q, idx) => (
                <div key={idx} style={{ background: "#151824", border: "1px solid #262B3D", borderRadius: 8, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 2 }}>
                    <span>{q.name}</span>
                    <span style={{ color: q.ok ? "#10B981" : "#FF7A3D", fontSize: 10 }}>{q.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#6B7280" }}>{q.engine} · 4K UHD 24fps</div>
                </div>
              ))}
            </div>
          </div>

          {/* Generate Scene CTA Button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            style={{
              width: "100%", padding: 14,
              background: isGenerating ? "#374151" : "linear-gradient(135deg, #FF7A3D, #EA580C)",
              border: "none", borderRadius: 12, color: "#fff",
              fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em",
              cursor: isGenerating ? "default" : "pointer",
              boxShadow: isGenerating ? "none" : "0 4px 20px rgba(255,122,61,0.4)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
            <Icon name="sparkle" size={16} />
            <span>{isGenerating ? `Rendering Scene (${genProgress}%)` : "Generate Scene"}</span>
            <kbd style={{ background: "rgba(0,0,0,0.25)", padding: "2px 6px", borderRadius: 4, fontSize: 10 }}>⌘↵</kbd>
          </button>
        </div>
      </div>

      {/* Bottom Multi-Track Storyboard Timeline */}
      <footer style={{
        height: 140, background: "#0A0B10", borderTop: "1px solid #1E2230",
        padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase" }}>Multi-Track Storyboard Timeline</div>
          <div style={{ display: "flex", gap: 14, fontSize: 10, color: "#6B7280", fontFamily: "ui-monospace, monospace" }}>
            <span>00:00:00</span>
            <span>00:00:05</span>
            <span>00:00:10</span>
            <span>00:00:15</span>
            <span>00:00:20</span>
            <span>00:00:25</span>
          </div>
        </div>

        {/* Video Track 1 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "#9CA3AF", width: 55 }}>VIDEO 1</span>
          <div style={{ flex: 1, display: "flex", gap: 6, background: "#12141D", borderRadius: 6, padding: 3, border: "1px solid #1E2230" }}>
            {clips.map((c) => (
              <div
                key={c.id}
                style={{
                  width: `${c.widthPct}%`, background: `linear-gradient(135deg, ${c.color}33, ${c.color}11)`,
                  border: `1px solid ${c.color}`, borderRadius: 4, padding: "6px 8px",
                  fontSize: 11, fontWeight: 700, color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center",
                  cursor: "pointer",
                }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span style={{ fontSize: 9, opacity: 0.7 }}>{c.duration}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Audio Track 1 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: "#9CA3AF", width: 55 }}>AUDIO 1</span>
          <div style={{ flex: 1, background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 6, padding: "4px 8px", display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#10B981", marginRight: 8 }}>Dialogue / Foley Mix</span>
            {Array.from({ length: 45 }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: Math.max(3, (Math.sin(i * 0.5) + 1) * 7), background: "#10B981", opacity: 0.6, borderRadius: 1 }} />
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
