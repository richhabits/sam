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
  const [prompt, setPrompt] = useState("Scene description - then inastering into this cinematic enenatics, innema to the newromanans and futvorare dohering of cyber-drone, hovear the futurity scene.\n\nPrompt: your saten-went rise include on the, right noother omanoure and showame.");
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
      .catch(() => {});
    fetch("/api/studio/presets/lenses")
      .then((res) => res.json())
      .then((data) => {
        const found = Array.isArray(data?.lenses) ? data.lenses.find((l: any) => l.id === DEFAULT_LENS_ID) : null;
        if (found) setLens(found);
      })
      .catch(() => {});
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
      background: "#1E1E1E",
      color: "#FFFFFF",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif",
      boxSizing: "border-box",
      userSelect: "none",
    }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: "#D9A05B", color: "#111", padding: "12px 20px",
          borderRadius: 8, fontWeight: 600, fontSize: 13,
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 8
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "center", position: "relative",
        borderBottom: "1px solid #333", padding: "12px", background: "#1A1A1A",
      }}>
        <div style={{ position: "absolute", left: 16, display: "flex", gap: 8 }}>
          <div onClick={back} style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF5F56", cursor: "pointer" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FFBD2E" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#27C93F" }} />
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, color: "#AAA" }}>SAM Studio Director</div>
        <div style={{ position: "absolute", right: 16, display: "flex", gap: 12 }}>
          <Icon name="cloud" size={16} />
          <Icon name="grid" size={16} />
        </div>
      </header>

      {/* Main Grid */}
      <div style={{
        display: "grid", gridTemplateColumns: "320px 1fr 300px", flex: 1, minHeight: 0, padding: "12px", gap: "12px", background: "#111"
      }}>
        {/* LEFT COLUMN: Script & Prompt */}
        <div style={{ background: "#1F1F1F", borderRadius: 8, border: "1px solid #333", padding: "16px", display: "flex", flexDirection: "column", gap: "24px", overflowY: "auto" }}>
          
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", color: "#DDD" }}>AI SCRIPT & PROMPT DIRECTOR</span>
              <button onClick={handleAutoEnhance} style={{ background: "none", border: "none", cursor: "pointer" }}>
                <span style={{ color: "#D9A05B" }}><Icon name="sparkle" size={14} /></span>
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              style={{
                width: "100%", background: "#141414", border: "1px solid #333", borderRadius: 8,
                padding: "12px", color: "#999", fontSize: 13, lineHeight: 1.6, resize: "none", outline: "none", boxSizing: "border-box", minHeight: 140
              }}
            />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", color: "#DDD" }}>MOTION INTENSITY</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#D9A05B" }}>{motionIntensity}%</span>
            </div>
            <input
              type="range" min="10" max="100" value={motionIntensity}
              onChange={(e) => setMotionIntensity(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#D9A05B" }}
            />
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", color: "#DDD" }}>CAMERA MOVEMENT</span>
              <span style={{ fontSize: 10 }}>▼</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {MOTIONS.map((m) => {
                const on = motion === m.id;
                return (
                  <button
                    key={m.id} onClick={() => setMotion(m.id)}
                    style={{
                      background: on ? "rgba(217,160,91,0.1)" : "transparent",
                      border: on ? "1px solid #D9A05B" : "1px solid #444",
                      borderRadius: 6, padding: "12px 4px", color: on ? "#D9A05B" : "#888",
                      fontWeight: 600, fontSize: 10, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8
                    }}>
                    <Icon name={m.icon as any} size={16} /> {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", color: "#DDD", display: "block", marginBottom: 12 }}>LIGHTING PRESETS</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              {STYLES.map((s) => {
                const on = style === s.id;
                return (
                  <div key={s.id} onClick={() => setStyle(s.id)} style={{ cursor: "pointer" }}>
                    <div style={{ 
                      height: 60, borderRadius: 6, marginBottom: 6, border: on ? "2px solid #D9A05B" : "1px solid #444",
                      backgroundImage: `url(/api/studio/preview/${s.id})`, backgroundSize: "cover", backgroundPosition: "center"
                    }} />
                    <div style={{ fontSize: 10, color: on ? "#D9A05B" : "#888", textAlign: "center", fontWeight: 500 }}>{s.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* CENTER COLUMN: Video Player */}
        <div style={{ background: "#1F1F1F", borderRadius: 8, border: "1px solid #333", display: "flex", flexDirection: "column", position: "relative" }}>
          <div style={{ flex: 1, background: "#000", borderTopLeftRadius: 8, borderTopRightRadius: 8, position: "relative", overflow: "hidden" }}>
            
            {/* The actual video or realistic drone background. */}
            {genUrl ? (
              genUrl.match(/\.(jpeg|jpg|png|webp)$/i) ? (
                <img src={genUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <video src={genUrl} autoPlay loop controls style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
                <div style={{ position: "absolute", inset: "40px", border: "1px solid rgba(255,255,255,0.4)" }}>
                  <div style={{ position: "absolute", top: -1, left: -1, width: 20, height: 20, borderTop: "2px solid #FFF", borderLeft: "2px solid #FFF" }} />
                  <div style={{ position: "absolute", top: -1, right: -1, width: 20, height: 20, borderTop: "2px solid #FFF", borderRight: "2px solid #FFF" }} />
                  <div style={{ position: "absolute", bottom: -1, left: -1, width: 20, height: 20, borderBottom: "2px solid #FFF", borderLeft: "2px solid #FFF" }} />
                  <div style={{ position: "absolute", bottom: -1, right: -1, width: 20, height: 20, borderBottom: "2px solid #FFF", borderRight: "2px solid #FFF" }} />
                </div>

                <div style={{ position: "absolute", top: 20, right: 20, background: "rgba(30,30,30,0.8)", padding: "10px 16px", borderRadius: 6, backdropFilter: "blur(4px)" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#FFF", marginBottom: 6 }}>CRANE PEDESTAL UP</div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, color: "#D9A05B" }}>MOTION</span>
                    <div onClick={() => setMotionToggle(!motionToggle)} style={{ width: 28, height: 14, background: motionToggle ? "#D9A05B" : "#555", borderRadius: 7, position: "relative", cursor: "pointer" }}>
                        <div style={{ position: "absolute", top: 2, left: motionToggle ? 16 : 2, width: 10, height: 10, background: "#FFF", borderRadius: "50%", transition: "left 0.2s" }} />
                    </div>
                  </div>
                </div>

                <div style={{ position: "absolute", bottom: 20, right: 20, textAlign: "right" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#FFF", letterSpacing: "1px" }}>ANAMORPHIC</div>
                  <div style={{ fontSize: 11, color: "#AAA" }}>{lens ? `${lens.name.split(" ")[0].toUpperCase()} ${lens.focalLength.toUpperCase()} ${lens.aperture}` : "PANAVISION 35MM T2.1"}</div>
                </div>
              </>
            )}

          </div>
          
          {/* Playback Controls */}
          <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 12, color: "#AAA", fontFamily: "monospace" }}>00:00:00 x 7889</span>
            
            <div style={{ flex: 1, position: "relative", height: 4, background: "#333", borderRadius: 2 }}>
              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: "40%", background: "#D9A05B", borderRadius: 2 }} />
              <div style={{ position: "absolute", top: -4, left: "40%", height: 12, width: 12, background: "#D9A05B", borderRadius: "50%" }} />
            </div>

            <div style={{ display: "flex", gap: 12, color: "#888", alignItems: "center" }}>
              <span onClick={() => showToast("⏮ Jump to start")} style={{ fontSize: 14, cursor: "pointer" }}>⏮</span>
              <span onClick={() => showToast("⏪ Rewind")} style={{ fontSize: 14, cursor: "pointer" }}>⏪</span>
              <span onClick={() => showToast(genUrl && genUrl.match(/\.(jpeg|jpg|png|webp)$/i) ? "⚠️ Cannot play static image. Add an API key for video!" : "▶️ Play")} style={{ color: "#FFF", cursor: "pointer" }}><Icon name="play" size={18} /></span>
              <span onClick={() => showToast("⏩ Fast Forward")} style={{ fontSize: 14, cursor: "pointer" }}>⏩</span>
              <span onClick={() => showToast("⏭ Jump to end")} style={{ fontSize: 14, cursor: "pointer" }}>⏭</span>
            </div>

            <div style={{ display: "flex", gap: 12, color: "#888", marginLeft: "auto" }}>
              <span style={{ fontSize: 10, cursor: "pointer" }} onClick={() => showToast("Aspect ratio locked")}>16:9</span>
              <span style={{ cursor: "pointer" }} onClick={() => showToast("Framing options locked")}><Icon name="frame" size={14} /></span>
              <span style={{ cursor: "pointer" }} onClick={() => showToast("Playback settings")}><Icon name="settings" size={14} /></span>
              <span style={{ cursor: "pointer" }} onClick={() => showToast("Fullscreen mode")}><Icon name="screen" size={14} /></span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Queue & Settings */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          
          <div style={{ background: "#1F1F1F", borderRadius: 8, border: "1px solid #333", padding: "16px", flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", color: "#DDD" }}>GENERATION QUEUE</span>
              <span style={{ cursor: "pointer" }} onClick={() => showToast("Clear queue")}><Icon name="trash" size={14} /></span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {isGenerating ? (
                <div style={{ background: "#141414", border: "1px solid #444", borderRadius: 6, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#FFF" }}>
                    <div style={{ width: 6, height: 6, background: "#D9A05B", borderRadius: "50%" }} /> Rendering ({genProgress}%)
                  </div>
                  <span style={{ color: "#888", cursor: "pointer" }} onClick={() => showToast("Cancel render")}><Icon name="refresh" size={14} /></span>
                </div>
              ) : genUrl ? (
                 <div style={{ background: "#141414", border: "1px solid #444", borderRadius: 6, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => showToast("Load completed scene")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#27C93F" }}>
                    <div style={{ width: 6, height: 6, background: "#27C93F", borderRadius: "50%" }} /> Completed
                  </div>
                  <span style={{ color: "#27C93F" }}><Icon name="check" size={14} /></span>
                </div>
              ) : null}

              <div style={{ background: "#141414", border: "1px solid #333", borderRadius: 6, padding: "10px 12px", fontSize: 12, color: "#888", cursor: "pointer" }} onClick={() => showToast("Load pending scene")}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 6, height: 6, background: "#555", borderRadius: "50%" }} /> Scene 4 - Pending
                </div>
              </div>
            </div>
          </div>

          <div style={{ background: "#1F1F1F", borderRadius: 8, border: "1px solid #333", padding: "16px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.5px", color: "#DDD", marginBottom: 12 }}>RENDER SETTINGS</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[ {val: engine, set: setEngine}, {val: resolution, set: setResolution}, {val: fps, set: setFps} ].map((dropdown, i) => (
                <div key={i} onClick={() => showToast("⚠️ Pro Setting: Unlock with API Key")} style={{ cursor: "pointer", background: "#141414", border: "1px solid #333", borderRadius: 6, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#AAA", fontSize: 12 }}>
                  {dropdown.val}
                  <span style={{ fontSize: 10 }}>▼</span>
                </div>
              ))}
            </div>

            <button onClick={handleGenerate} disabled={isGenerating} style={{
              width: "100%", marginTop: 16, background: isGenerating ? "#444" : "linear-gradient(180deg, #EDBE7D 0%, #D9A05B 100%)",
              color: isGenerating ? "#888" : "#111", border: "none", borderRadius: 6, padding: "12px", fontSize: 12, fontWeight: 700, letterSpacing: "1px", cursor: isGenerating ? "default" : "pointer",
            }}>
              {isGenerating ? `RENDERING...` : `GENERATE & EXPORT`}
            </button>
          </div>

        </div>
      </div>

      {/* BOTTOM COLUMN: Timeline */}
      <div style={{ height: 160, background: "#1A1A1A", borderTop: "1px solid #333", padding: "12px 16px", display: "flex", gap: "16px" }}>
        {/* Track Labels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: 60 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#888" }}>
             <span style={{ fontSize: 12 }}>↰</span> <Icon name="copy" size={14} />
          </div>
          <div style={{ fontSize: 11, color: "#DDD", height: 44, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#888" }}><Icon name="grid" size={12} /></span> Video 1
          </div>
          <div style={{ fontSize: 11, color: "#888", height: 20, display: "flex", alignItems: "center" }}>Audio 1</div>
          <div style={{ fontSize: 11, color: "#888", height: 20, display: "flex", alignItems: "center" }}>Audio 2</div>
        </div>

        {/* Timeline Content */}
        <div style={{ flex: 1, position: "relative" }}>
          
          {/* Time markers */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#888", marginBottom: 8, paddingLeft: 4, borderBottom: "1px solid #333", paddingBottom: 4 }}>
            <span>0:00</span><span>0:15</span><span>0:30</span><span>0:45</span><span>1:00</span><span>1:15</span>
          </div>

          {/* Playhead */}
          <div style={{ position: "absolute", top: 0, left: "4%", width: 2, height: "100%", background: "#D9A05B", zIndex: 10 }}>
            <div style={{ position: "absolute", top: 18, left: -4, width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid #D9A05B" }} />
          </div>

          {/* Video Track */}
          <div style={{ display: "flex", gap: 4, height: 44, marginBottom: 12 }}>
            {timeline.map((clip, i) => (
              <div key={clip.id} className="studio-timeline-clip" style={{ 
                flex: i === timeline.length - 1 ? 1.5 : 1, 
                border: i === timeline.length - 1 ? "2px solid #D9A05B" : undefined,
                backgroundImage: `url(${clip.img})`
              }}>
                <div style={{ position: "absolute", bottom: 4, left: 6, fontSize: 10, color: "#FFF", background: "rgba(0,0,0,0.6)", padding: "2px 4px", borderRadius: 2 }}>{clip.time}</div>
                 {i < timeline.length -1 && <span style={{ color: "#D9A05B", position: "absolute", right: -6, top: "50%", transform: "translateY(-50%)", zIndex: 5 }}><Icon name="play" size={10} /></span>}
              </div>
            ))}
          </div>

          {/* Audio Tracks */}
          <div style={{ height: 20, background: "rgba(217,160,91,0.1)", borderRadius: 4, marginBottom: 12, display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden" }}>
             {/* Simulate waveform */}
             {Array.from({length: 100}).map((_, i) => (
               <div key={i} style={{ width: 2, height: Math.max(2, Math.sin(i * 0.3) * 12 + Math.random() * 8), background: "#D9A05B", margin: "0 1px", opacity: 0.7 }} />
             ))}
          </div>

          <div style={{ height: 20, background: "rgba(136,136,136,0.1)", borderRadius: 4, display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden" }}>
             {Array.from({length: 100}).map((_, i) => (
               <div key={i} style={{ width: 2, height: Math.max(2, Math.sin(i * 0.1) * 8 + Math.random() * 4), background: "#666", margin: "0 1px", opacity: 0.7 }} />
             ))}
          </div>

        </div>
      </div>
    </div>
  );
}
