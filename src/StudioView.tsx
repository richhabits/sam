import { useState, useEffect } from "react";
import Icon from "./Icon";

type TimelineClip = { id: string; time: string; img: string; name: string };

const STYLES = [
  { id: "cinematic", label: "Cinematic" },
  { id: "photoreal", label: "Photoreal" },
  { id: "anime", label: "Anime" },
  { id: "3d", label: "3D Pixar" },
  { id: "product", label: "Product" },
  { id: "logo", label: "Logo" },
  { id: "neon", label: "Neon" },
  { id: "oil", label: "Oil Painting" },
  { id: "water", label: "Watercolour" },
  { id: "pixel", label: "Pixel Art" },
  { id: "comic", label: "Comic" },
  { id: "fantasy", label: "Fantasy" },
  { id: "lineart", label: "Line Art" },
  { id: "vapor", label: "Vaporwave" },
  { id: "clay", label: "Claymation" },
  { id: "blueprint", label: "Blueprint" },
  { id: "dusk", label: "Cinematic Dusk" },
  { id: "noir", label: "High Contrast Noir" },
  { id: "golden", label: "Golden Hour" },
  { id: "cyber", label: "Cyberpunk" },
];

const MOTIONS = [
  { id: "dolly", label: "DOLLY", icon: "camera" },
  { id: "steadicam", label: "STEADICAM", icon: "camera" },
  { id: "orbit", label: "360 ORBIT", icon: "refresh" },
];

// Maps the 3 motion buttons above onto real Higgsfield camera-rig ids from
// server/studio-higgsfield.ts (fallback values if /api/studio/presets/motion is unreachable).
const MOTION_RIG_FALLBACK: Record<string, string> = {
  dolly: "dolly_in_rapid",
  steadicam: "steadicam_tracking",
  orbit: "orbit_360_cw",
};
const DEFAULT_LENS_ID = "anamorphic_panavision";

const TIMELINE_CLIPS = [
  { id: "c1", time: "0:00", img: "/api/studio/preview/dusk", name: "Drone Shot" },
  { id: "c2", time: "0:15", img: "/api/studio/preview/noir", name: "Hallway" },
  { id: "c3", time: "0:30", img: "/api/studio/preview/cyber", name: "Drone Shot 2" },
  { id: "c4", time: "0:45", img: "/api/studio/preview/photoreal", name: "Alien Ship" },
  { id: "c5", time: "1:00", img: "/api/studio/preview/cinematic", name: "City" },
  { id: "c6", time: "1:15", img: "/api/studio/preview/golden", name: "Explosion" },
];

export default function StudioView() {
  const [prompt, setPrompt] = useState("A cinematic establishing shot of a futuristic metropolis at dusk. Neon lights reflect off wet obsidian streets, while autonomous drones glide silently between towering skyscrapers. High contrast, volumetric lighting, photorealistic.");
  const [motion, setMotion] = useState("dolly");
  const [motionIntensity, setMotionIntensity] = useState(75);
  const [style, setStyle] = useState("dusk");
  const [motionToggle, setMotionToggle] = useState(true);

  // Render Settings State
  const [engine, setEngine] = useState("FLUX/HIGGSFIELD/SORA");
  const [resolution, setResolution] = useState("4K UHD");
  const [fps, setFps] = useState("24fps");

  const [toast, setToast] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genUrl, setGenUrl] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState(0);

  const [timeline, setTimeline] = useState<TimelineClip[]>(() => {
    const saved = localStorage.getItem("studio_timeline");
    return saved ? JSON.parse(saved) : [...TIMELINE_CLIPS];
  });

  const [cameraRigs, setCameraRigs] = useState<{ id: string; label: string }[]>([]);
  const [lens, setLens] = useState<{ id: string; name: string; focalLength: string; aperture: string } | null>(null);

  useEffect(() => {
    localStorage.setItem("studio_timeline", JSON.stringify(timeline));
  }, [timeline]);

  useEffect(() => {
    fetch("/api/studio/presets/motion")
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data?.cameras)) setCameraRigs(data.cameras); })
      .catch(() => {
        // Backend unreachable — rigIdFor() falls back to MOTION_RIG_FALLBACK.
      });
    fetch("/api/studio/presets/lenses")
      .then((res) => res.json())
      .then((data) => {
        const found = Array.isArray(data?.lenses) ? data.lenses.find((l: any) => l.id === DEFAULT_LENS_ID) : null;
        if (found) setLens(found);
      })
      .catch(() => {
        // Backend unreachable — the overlay keeps its static "PANAVISION 35MM T2.1" fallback text.
      });
  }, []);

  const rigIdFor = (motionKey: string) => {
    const fallback = MOTION_RIG_FALLBACK[motionKey];
    return cameraRigs.find((r) => r.id === fallback)?.id || fallback;
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenProgress(10);
    showToast("🎬 Dispatching scene to rendering engine...");
    
    // Simulate progress bar while waiting for fetch
    const progressInterval = setInterval(() => {
      setGenProgress(p => (p < 90 ? p + 5 : p));
    }, 800);

    try {
      // Compile the real Higgsfield motion/lens prompt from the selected camera rig,
      // instead of hand-concatenating "Motion: dolly" into the prompt string.
      let compiledPrompt = `${prompt} | Style: ${style} | Motion: ${motion}`;
      try {
        const motionRes = await fetch("/api/studio/motion/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            basePrompt: `${prompt} | Style: ${style}`,
            cameraRigId: rigIdFor(motion),
            lensId: DEFAULT_LENS_ID,
            motionIntensity: motionIntensity / 50,
            aspectRatio: "16:9",
          }),
        });
        const motionData = await motionRes.json();
        if (motionData?.compiledPrompt) compiledPrompt = motionData.compiledPrompt;
      } catch {
        // Fall back to the plain concatenated prompt above if motion/control is unreachable.
      }

      // Fire real backend request to generate video
      let res = await fetch("/api/studio/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: compiledPrompt })
      });
      let data = await res.json();

      // Fallback to Image API if video requires key
      if (data.error && data.error.includes("free-credit key")) {
        showToast("📷 Video requires API key. Falling back to free image generation...");
        res = await fetch("/api/studio/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: compiledPrompt })
        });
        data = await res.json();
      }

      clearInterval(progressInterval);
      setGenProgress(100);
      
      if (data.url) {
        setGenUrl(data.url);
        
        // Make the mock dynamic: Add the newly generated asset to the timeline!
        setTimeline((prev: TimelineClip[]) => [
          ...prev, 
          { 
            id: `gen-${Date.now()}`, 
            time: `1:${prev.length * 15}`, 
            img: data.url, 
            name: "Generated Shot" 
          }
        ]);

        showToast("✓ Scene rendered successfully and added to timeline!");
      } else {
        showToast("⚠️ Render failed: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      showToast("⚠️ Network error during render.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAutoEnhance = async () => {
    showToast("✨ Auto-Enhancing Prompt...");
    try {
      const res = await fetch("/api/studio/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, style, camera: motion })
      });
      const data = await res.json();
      if (data.prompt) {
        setPrompt(data.prompt);
        showToast("✓ Prompt optimized.");
      }
    } catch {
      showToast("⚠️ Enhancement failed.");
    }
  };

  const back = () => {
    const sd = (globalThis as any).samDesktop;
    if (sd?.close) sd.close();
    else { window.close(); setTimeout(() => { if (!window.closed) location.href = "/"; }, 50); }
  };

  return (
    <div style={{
      background: "#111111",
      color: "var(--text)",
      height: "100vh",
      maxHeight: "100vh",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
      boxSizing: "border-box",
      userSelect: "none",
    }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: "#D9A05B", color: "#111", padding: "10px 16px",
          borderRadius: 8, fontWeight: 700, fontSize: 12,
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", gap: 8
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <header style={{
        height: 38, minHeight: 38,
        display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
        borderBottom: "1px solid #262626", padding: "0 14px", background: "#161616",
      }}>
        <div style={{ position: "absolute", left: 14, display: "flex", gap: 6 }}>
          <div onClick={back} style={{ width: 11, height: 11, borderRadius: "50%", background: "#FF5F56", cursor: "pointer" }} />
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#FFBD2E" }} />
          <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#27C93F" }} />
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#DDD", letterSpacing: "0.4px" }}>SAM Studio Director</div>
        <div style={{ position: "absolute", right: 14, display: "flex", gap: 10, color: "#888" }}>
          <Icon name="cloud" size={14} />
          <Icon name="grid" size={14} />
        </div>
      </header>

      {/* Main Grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "290px 1fr 270px", flex: 1, minHeight: 0, padding: "8px 10px", gap: "10px", background: "#0D0D0D", overflow: "hidden"
      }}>
        {/* LEFT COLUMN: Script & Prompt */}
        <div style={{ background: "#161616", borderRadius: 8, border: "1px solid #262626", padding: "12px", display: "flex", flexDirection: "column", gap: "10px", overflowY: "auto", minHeight: 0 }}>
          
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", color: "#BBB" }}>AI SCRIPT & PROMPT DIRECTOR</span>
              <button onClick={handleAutoEnhance} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                <span style={{ color: "#D9A05B" }}><Icon name="sparkle" size={13} /></span>
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{
                width: "100%", background: "#0E0E0E", border: "1px solid #2E2E2E", borderRadius: 6,
                padding: "8px 10px", color: "#CCC", fontSize: 11, lineHeight: 1.45, resize: "none", outline: "none", boxSizing: "border-box", height: 72, minHeight: 60
              }}
            />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", color: "#BBB" }}>MOTION INTENSITY</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#D9A05B" }}>{motionIntensity}%</span>
            </div>
            <input
              type="range" min="10" max="100" value={motionIntensity}
              onChange={(e) => setMotionIntensity(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#D9A05B", height: 4, cursor: "pointer" }}
            />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", color: "#BBB" }}>CAMERA MOVEMENT</span>
              <span style={{ fontSize: 9, color: "#666" }}>▼</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {MOTIONS.map((m) => {
                const on = motion === m.id;
                return (
                  <button
                    key={m.id} onClick={() => setMotion(m.id)}
                    style={{
                      background: on ? "rgba(217,160,91,0.12)" : "transparent",
                      border: on ? "1px solid #D9A05B" : "1px solid #333",
                      borderRadius: 6, padding: "6px 2px", color: on ? "#D9A05B" : "#888",
                      fontWeight: 600, fontSize: 9, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4
                    }}>
                    <Icon name={m.icon as any} size={14} /> {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", color: "#BBB", display: "block", marginBottom: 6 }}>LIGHTING PRESETS</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {STYLES.map((s) => {
                const on = style === s.id;
                return (
                  <div key={s.id} onClick={() => setStyle(s.id)} style={{ cursor: "pointer" }}>
                    <div style={{ 
                      height: 38, borderRadius: 5, marginBottom: 3, border: on ? "2px solid #D9A05B" : "1px solid #333",
                      backgroundImage: `url(/api/studio/preview/${s.id})`, backgroundSize: "cover", backgroundPosition: "center"
                    }} />
                    <div style={{ fontSize: 9, color: on ? "#D9A05B" : "#777", textAlign: "center", fontWeight: 600 }}>{s.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* CENTER COLUMN: Video Player */}
        <div style={{ background: "#161616", borderRadius: 8, border: "1px solid #262626", display: "flex", flexDirection: "column", position: "relative", minHeight: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, minHeight: 0, background: "#000", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            
            {/* The actual video or realistic drone background. */}
            {genUrl ? (
              genUrl.match(/\.(jpeg|jpg|png|webp)$/i) ? (
                <img src={genUrl} alt="Generated scene preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <video src={genUrl} autoPlay loop controls style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              )
            ) : (
              <div style={{
                position: "absolute", inset: 0,
                backgroundImage: "url(/api/studio/preview/cyber)",
                backgroundSize: "cover", backgroundPosition: "center",
                filter: "brightness(0.7) contrast(1.2)"
              }} />
            )}

            {/* Bounding Box Overlay (only show if no generated video) */}
            {!genUrl && (
              <>
                <div style={{ position: "absolute", inset: "24px", border: "1px solid rgba(255,255,255,0.3)" }}>
                  <div style={{ position: "absolute", top: -1, left: -1, width: 14, height: 14, borderTop: "2px solid var(--text)", borderLeft: "2px solid var(--text)" }} />
                  <div style={{ position: "absolute", top: -1, right: -1, width: 14, height: 14, borderTop: "2px solid var(--text)", borderRight: "2px solid var(--text)" }} />
                  <div style={{ position: "absolute", bottom: -1, left: -1, width: 14, height: 14, borderBottom: "2px solid var(--text)", borderLeft: "2px solid var(--text)" }} />
                  <div style={{ position: "absolute", bottom: -1, right: -1, width: 14, height: 14, borderBottom: "2px solid var(--text)", borderRight: "2px solid var(--text)" }} />
                </div>

                <div style={{ position: "absolute", top: 14, right: 14, background: "rgba(20,20,20,0.85)", padding: "6px 12px", borderRadius: 6, backdropFilter: "blur(4px)" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>CRANE PEDESTAL UP</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <span style={{ fontSize: 9, color: "#D9A05B" }}>MOTION</span>
                    <div onClick={() => setMotionToggle(!motionToggle)} style={{ width: 24, height: 12, background: motionToggle ? "#D9A05B" : "#444", borderRadius: 6, position: "relative", cursor: "pointer" }}>
                        <div style={{ position: "absolute", top: 2, left: motionToggle ? 14 : 2, width: 8, height: 8, background: "var(--text)", borderRadius: "50%", transition: "left 0.2s" }} />
                    </div>
                  </div>
                </div>

                <div style={{ position: "absolute", bottom: 14, right: 14, textAlign: "right" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", letterSpacing: "1px" }}>ANAMORPHIC</div>
                  <div style={{ fontSize: 10, color: "#888" }}>{lens ? `${lens.name.split(" ")[0].toUpperCase()} ${lens.focalLength.toUpperCase()} ${lens.aperture}` : "PANAVISION 35MM T2.1"}</div>
                </div>
              </>
            )}

          </div>
          
          {/* Playback Controls Bar */}
          <div style={{ height: 36, minHeight: 36, padding: "0 14px", display: "flex", alignItems: "center", gap: 12, background: "#141414", borderTop: "1px solid #222" }}>
            <span style={{ fontSize: 11, color: "#888", fontFamily: "monospace" }}>00:00:00 x 7889</span>
            
            <div style={{ flex: 1, position: "relative", height: 3, background: "#2E2E2E", borderRadius: 2 }}>
              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "40%", background: "#D9A05B", borderRadius: 2 }} />
              <div style={{ position: "absolute", top: -3, left: "40%", height: 9, width: 9, background: "#D9A05B", borderRadius: "50%" }} />
            </div>

            <div style={{ display: "flex", gap: 10, color: "#888", alignItems: "center" }}>
              <span onClick={() => showToast("⏮ Jump to start")} style={{ fontSize: 12, cursor: "pointer" }}>⏮</span>
              <span onClick={() => showToast("⏪ Rewind")} style={{ fontSize: 12, cursor: "pointer" }}>⏪</span>
              <span onClick={() => showToast(genUrl && genUrl.match(/\.(jpeg|jpg|png|webp)$/i) ? "⚠️ Cannot play static image. Add an API key for video!" : "▶️ Play")} style={{ color: "var(--text)", cursor: "pointer" }}><Icon name="play" size={15} /></span>
              <span onClick={() => showToast("⏩ Fast Forward")} style={{ fontSize: 12, cursor: "pointer" }}>⏩</span>
              <span onClick={() => showToast("⏭ Jump to end")} style={{ fontSize: 12, cursor: "pointer" }}>⏭</span>
            </div>

            <div style={{ display: "flex", gap: 10, color: "#777", marginLeft: "auto" }}>
              <span style={{ fontSize: 9, cursor: "pointer", color: "#AAA" }} onClick={() => showToast("Aspect ratio locked")}>16:9</span>
              <span style={{ cursor: "pointer" }} onClick={() => showToast("Framing options locked")}><Icon name="frame" size={13} /></span>
              <span style={{ cursor: "pointer" }} onClick={() => showToast("Playback settings")}><Icon name="settings" size={13} /></span>
              <span style={{ cursor: "pointer" }} onClick={() => showToast("Fullscreen mode")}><Icon name="screen" size={13} /></span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Queue & Settings */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", minHeight: 0, overflow: "hidden" }}>
          
          <div style={{ background: "#161616", borderRadius: 8, border: "1px solid #262626", padding: "12px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", color: "#BBB" }}>GENERATION QUEUE</span>
              <span style={{ cursor: "pointer", color: "#666" }} onClick={() => showToast("Clear queue")}><Icon name="trash" size={12} /></span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
              {isGenerating ? (
                <div style={{ background: "#0E0E0E", border: "1px solid #333", borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text)" }}>
                    <div style={{ width: 5, height: 5, background: "#D9A05B", borderRadius: "50%" }} /> Rendering ({genProgress}%)
                  </div>
                  <span style={{ color: "#888", cursor: "pointer" }} onClick={() => showToast("Cancel render")}><Icon name="refresh" size={12} /></span>
                </div>
              ) : genUrl ? (
                 <div style={{ background: "#0E0E0E", border: "1px solid #2E2E2E", borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => showToast("Load completed scene")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#27C93F" }}>
                    <div style={{ width: 5, height: 5, background: "#27C93F", borderRadius: "50%" }} /> Completed Shot
                  </div>
                  <span style={{ color: "#27C93F" }}><Icon name="check" size={12} /></span>
                </div>
              ) : null}

              <div style={{ background: "#0E0E0E", border: "1px solid #222", borderRadius: 6, padding: "8px 10px", fontSize: 11, color: "#777", cursor: "pointer" }} onClick={() => showToast("Load pending scene")}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 5, height: 5, background: "#444", borderRadius: "50%" }} /> Scene 4 - Standby
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: "#161616", borderRadius: 8, border: "1px solid #262626", padding: "12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", color: "#BBB", marginBottom: 2 }}>RENDER SETTINGS</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[ {val: engine, set: setEngine}, {val: resolution, set: setResolution}, {val: fps, set: setFps} ].map((dropdown, i) => (
                <div key={i} onClick={() => showToast("⚠️ Pro Setting: Unlock with API Key")} style={{ cursor: "pointer", background: "#0E0E0E", border: "1px solid #262626", borderRadius: 5, padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#999", fontSize: 11 }}>
                  {dropdown.val}
                  <span style={{ fontSize: 9, color: "#666" }}>▼</span>
                </div>
              ))}
            </div>

            <button onClick={handleGenerate} disabled={isGenerating} style={{
              width: "100%", marginTop: 6, background: isGenerating ? "#333" : "linear-gradient(180deg, #EDBE7D 0%, #D9A05B 100%)",
              color: isGenerating ? "#777" : "#111", border: "none", borderRadius: 6, padding: "10px", fontSize: 11, fontWeight: 800, letterSpacing: "0.8px", cursor: isGenerating ? "default" : "pointer",
            }}>
              {isGenerating ? `RENDERING...` : `GENERATE & EXPORT`}
            </button>
          </div>

        </div>
      </div>

      {/* BOTTOM COLUMN: Timeline */}
      <div style={{ height: 115, minHeight: 115, maxHeight: 115, background: "#141414", borderTop: "1px solid #262626", padding: "8px 14px", display: "flex", gap: "14px", boxSizing: "border-box", overflow: "hidden" }}>
        {/* Track Labels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 55 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#777" }}>
             <span style={{ fontSize: 11 }}>↰</span> <Icon name="copy" size={12} />
          </div>
          <div style={{ fontSize: 10, color: "#CCC", height: 32, display: "flex", alignItems: "center", gap: 4, fontWeight: 600 }}>
            <span style={{ color: "#777" }}><Icon name="grid" size={11} /></span> Video
          </div>
          <div style={{ fontSize: 10, color: "#777", height: 14, display: "flex", alignItems: "center" }}>Audio 1</div>
          <div style={{ fontSize: 10, color: "#777", height: 14, display: "flex", alignItems: "center" }}>Audio 2</div>
        </div>

        {/* Timeline Content */}
        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
          
          {/* Time markers */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#777", marginBottom: 6, paddingLeft: 4, borderBottom: "1px solid #262626", paddingBottom: 2 }}>
            <span>0:00</span><span>0:15</span><span>0:30</span><span>0:45</span><span>1:00</span><span>1:15</span>
          </div>

          {/* Playhead */}
          <div style={{ position: "absolute", top: 0, left: "4%", width: 2, height: "100%", background: "#D9A05B", zIndex: 10 }}>
            <div style={{ position: "absolute", top: 14, left: -3, width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "5px solid #D9A05B" }} />
          </div>

          {/* Video Track */}
          <div style={{ display: "flex", gap: 4, height: 32, marginBottom: 8 }}>
            {timeline.map((clip, i) => (
              <div key={clip.id} className="studio-timeline-clip" style={{ 
                flex: i === timeline.length - 1 ? 1.5 : 1, 
                border: i === timeline.length - 1 ? "2px solid #D9A05B" : undefined,
                backgroundImage: `url(${clip.img})`
              }}>
                <div style={{ position: "absolute", bottom: 2, left: 4, fontSize: 9, color: "var(--text)", background: "rgba(0,0,0,0.7)", padding: "1px 3px", borderRadius: 2 }}>{clip.time}</div>
                 {i < timeline.length -1 && <span style={{ color: "#D9A05B", position: "absolute", right: -5, top: "50%", transform: "translateY(-50%)", zIndex: 5 }}><Icon name="play" size={9} /></span>}
              </div>
            ))}
          </div>

          {/* Audio Tracks */}
          <div style={{ height: 14, background: "rgba(217,160,91,0.08)", borderRadius: 3, marginBottom: 6, display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden" }}>
             {/* Simulate waveform */}
             {Array.from({length: 120}).map((_, i) => (
               <div key={i} style={{ width: 2, height: Math.max(2, Math.sin(i * 0.3) * 9 + Math.random() * 5), background: "#D9A05B", margin: "0 1px", opacity: 0.6 }} />
             ))}
          </div>

          <div style={{ height: 14, background: "rgba(136,136,136,0.08)", borderRadius: 3, display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden" }}>
             {Array.from({length: 120}).map((_, i) => (
               <div key={i} style={{ width: 2, height: Math.max(2, Math.sin(i * 0.1) * 6 + Math.random() * 3), background: "#666", margin: "0 1px", opacity: 0.6 }} />
             ))}
          </div>

        </div>
      </div>
    </div>
  );
}
