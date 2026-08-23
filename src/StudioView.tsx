import { useState, useEffect, useRef, useCallback } from "react";
import Icon from "./Icon";
import { queueStudioJob } from "./lib/api";

type TimelineClip = { id: string; time: string; startSec: number; durationSec: number; img: string; name: string };

const STYLES = [
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

const MOTIONS = [
  { id: "dolly_in", label: "DOLLY IN", rigId: "dolly_in_rapid", icon: "camera", desc: "Push-in" },
  { id: "dolly_out", label: "DOLLY OUT", rigId: "dolly_out_epic", icon: "camera", desc: "Pull-back" },
  { id: "steadicam", label: "STEADICAM", rigId: "steadicam_tracking", icon: "camera", desc: "Smooth follow" },
  { id: "orbit_cw", label: "360° ORBIT", rigId: "orbit_360_cw", icon: "refresh", desc: "Wrap sweep" },
  { id: "crane_up", label: "HERO CRANE", rigId: "crane_pedestal_up", icon: "arrow-up", desc: "Pedestal rise" },
  { id: "fpv_dive", label: "FPV DRONE", rigId: "fpv_drone_dive", icon: "sparkle", desc: "Acrobatic dive" },
  { id: "vertigo", label: "VERTIGO", rigId: "vertigo_hitchcock", icon: "refresh", desc: "Zolly zoom" },
  { id: "bullet_time", label: "BULLET TIME", rigId: "bullet_time_freeze", icon: "clock", desc: "Matrix freeze" },
];

const ENGINES = ["Wan 2.1 / HappyHorse", "Flux.1 Cinematic", "Higgsfield V2", "OpenAI Sora"];
const RESOLUTIONS = ["4K UHD (3840x2160)", "1080p Full HD", "8K Cinema", "720p Mobile"];
const FRAME_RATES = ["24 fps (Cinema)", "30 fps (Broadcast)", "60 fps (Smooth)", "120 fps (Slow-Mo)"];
const ASPECT_RATIOS = [
  { id: "16:9", label: "16:9 Cinema", css: "16 / 9" },
  { id: "9:16", label: "9:16 Reels/TikTok", css: "9 / 16" },
  { id: "1:1", label: "1:1 Square", css: "1 / 1" },
  { id: "2.39:1", label: "2.39:1 Anamorphic", css: "2.39 / 1" },
];

const DEFAULT_LENS_ID = "anamorphic_panavision";
const TOTAL_DURATION_SEC = 75; // 01:15 total timeline duration

const INITIAL_TIMELINE_CLIPS: TimelineClip[] = [
  { id: "c1", time: "0:00", startSec: 0, durationSec: 15, img: "/api/studio/preview/dusk", name: "Scene 1 · Drone Sweep" },
  { id: "c2", time: "0:15", startSec: 15, durationSec: 15, img: "/api/studio/preview/noir", name: "Scene 2 · Hallway Noir" },
  { id: "c3", time: "0:30", startSec: 30, durationSec: 15, img: "/api/studio/preview/cyber", name: "Scene 3 · Neon Rain" },
  { id: "c4", time: "0:45", startSec: 45, durationSec: 15, img: "/api/studio/preview/photoreal", name: "Scene 4 · Hypercar Drift" },
  { id: "c5", time: "1:00", startSec: 60, durationSec: 15, img: "/api/studio/preview/cinematic", name: "Scene 5 · Penthouse" },
];

export default function StudioView() {
  const [prompt, setPrompt] = useState(
    "A cinematic establishing shot of a futuristic metropolis at dusk. Neon lights reflect off wet obsidian streets, while autonomous drones glide silently between towering skyscrapers. High contrast, volumetric lighting, photorealistic, 8k."
  );
  const [motion, setMotion] = useState("dolly_in");
  const [motionIntensity, setMotionIntensity] = useState(75);
  const [style, setStyle] = useState("dusk");
  const [styleCategory, setStyleCategory] = useState<string>("ALL");
  const [motionToggle, setMotionToggle] = useState(true);
  const [aspectIndex, setAspectIndex] = useState(0);
  const [showFraming, setShowFraming] = useState(true);
  const [theaterMode, setTheaterMode] = useState(false);

  // Playback & Interactive Timeline Engine
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string>("c1");

  // Render Settings State
  const [engineIndex, setEngineIndex] = useState(0);
  const [resIndex, setResIndex] = useState(0);
  const [fpsIndex, setFpsIndex] = useState(0);
  const [localOnly, setLocalOnly] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genUrl, setGenUrl] = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState(0);

  const [timeline, setTimeline] = useState<TimelineClip[]>(() => {
    const saved = localStorage.getItem("studio_timeline");
    return saved ? JSON.parse(saved) : [...INITIAL_TIMELINE_CLIPS];
  });

  const [cameraRigs, setCameraRigs] = useState<{ id: string; label: string }[]>([]);
  const [lens, setLens] = useState<{ id: string; name: string; focalLength: string; aperture: string } | null>(null);

  const timelineTrackRef = useRef<HTMLDivElement | null>(null);

  const activeAspect = ASPECT_RATIOS[aspectIndex];
  const engine = ENGINES[engineIndex];
  const resolution = RESOLUTIONS[resIndex];
  const fps = FRAME_RATES[fpsIndex];

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

  // Playback Timer Loop
  useEffect(() => {
    let animFrame: number;
    let lastTime = performance.now();

    if (isPlaying) {
      const loop = (now: number) => {
        const deltaSec = (now - lastTime) / 1000;
        lastTime = now;

        setCurrentTimeSec((prev) => {
          const next = prev + deltaSec;
          if (next >= TOTAL_DURATION_SEC) {
            return 0; // Loop back
          }
          return next;
        });

        animFrame = requestAnimationFrame(loop);
      };
      animFrame = requestAnimationFrame(loop);
    }

    return () => cancelAnimationFrame(animFrame);
  }, [isPlaying]);

  // Sync active clip with currentTimeSec
  useEffect(() => {
    const clipIndex = Math.min(
      timeline.length - 1,
      Math.floor((currentTimeSec / TOTAL_DURATION_SEC) * timeline.length)
    );
    if (timeline[clipIndex] && timeline[clipIndex].id !== selectedClipId) {
      setSelectedClipId(timeline[clipIndex].id);
    }
  }, [currentTimeSec, timeline, selectedClipId]);

  // Spacebar toggle Play/Pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && (e.target as HTMLElement).tagName !== "TEXTAREA" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const activeClip = timeline.find((c) => c.id === selectedClipId) || timeline[0];

  const formatTimecode = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const f = Math.floor((sec % 1) * 24);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
  };

  const handleSeek = (sec: number) => {
    const bounded = Math.max(0, Math.min(TOTAL_DURATION_SEC, sec));
    setCurrentTimeSec(bounded);
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineTrackRef.current) return;
    const rect = timelineTrackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    handleSeek(ratio * TOTAL_DURATION_SEC);
  };

  const handleStep = (delta: number) => {
    handleSeek(currentTimeSec + delta);
    showToast(delta > 0 ? `⏩ Step forward +${delta}s` : `⏪ Step back ${delta}s`);
  };

  const handleJumpStart = () => {
    handleSeek(0);
    showToast("⏮ Jumped to start (00:00)");
  };

  const handleJumpEnd = () => {
    handleSeek(TOTAL_DURATION_SEC - 0.5);
    showToast("⏭ Jumped to end");
  };

  const cycleAspect = () => {
    const nextIdx = (aspectIndex + 1) % ASPECT_RATIOS.length;
    setAspectIndex(nextIdx);
    showToast(`📐 Aspect Ratio set to ${ASPECT_RATIOS[nextIdx].label}`);
  };

  const toggleFraming = () => {
    setShowFraming(!showFraming);
    showToast(!showFraming ? "⛶ Viewfinder overlay ON" : "⛶ Viewfinder overlay OFF");
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      showToast("⛶ Entered Fullscreen mode");
    } else {
      document.exitFullscreen().catch(() => {});
      showToast("Exit Fullscreen");
    }
  };

  const duplicateActiveClip = () => {
    if (!activeClip) return;
    const duplicated: TimelineClip = {
      ...activeClip,
      id: `copy-${Date.now()}`,
      name: `${activeClip.name} (Copy)`,
    };
    setTimeline((prev) => [...prev, duplicated]);
    setSelectedClipId(duplicated.id);
    showToast(`✓ Duplicated "${activeClip.name}"`);
  };

  const clearQueue = () => {
    setGenUrl(null);
    showToast("✓ Queue cleared");
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

    const progressInterval = setInterval(() => {
      setGenProgress((p) => (p < 90 ? p + 8 : p));
    }, 600);

    try {
      const selectedRig = MOTIONS.find((m) => m.id === motion)?.rigId || "dolly_in_rapid";
      let compiledPrompt = `${prompt} | Style: ${style} | Motion: ${selectedRig}`;

      try {
        const motionRes = await fetch("/api/studio/motion/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            basePrompt: `${prompt} | Style: ${style}`,
            cameraRigId: selectedRig,
            lensId: DEFAULT_LENS_ID,
            motionIntensity: motionIntensity / 50,
            aspectRatio: "16:9",
          }),
        });
        const motionData = await motionRes.json();
        if (motionData?.compiledPrompt) compiledPrompt = motionData.compiledPrompt;
      } catch {}

      let res = await fetch("/api/studio/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: compiledPrompt }),
      });
      let data = await res.json();

      if (data.error && data.error.includes("free-credit key")) {
        showToast("📷 Video requires API key. Falling back to free image generation...");
        res = await fetch("/api/studio/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: compiledPrompt }),
        });
        data = await res.json();
      }

      clearInterval(progressInterval);
      setGenProgress(100);

      if (data.url) {
        setGenUrl(data.url);
        const newClip: TimelineClip = {
          id: `gen-${Date.now()}`,
          time: formatTimecode(currentTimeSec).slice(3, 8),
          startSec: currentTimeSec,
          durationSec: 15,
          img: data.url,
          name: `Shot ${timeline.length + 1} (Generated)`,
        };
        setTimeline((prev) => [...prev, newClip]);
        setSelectedClipId(newClip.id);
        queueStudioJob(prompt, style, localOnly);
        showToast("✓ Scene rendered successfully and inserted into timeline!");
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
        body: JSON.stringify({ prompt, style, camera: motion }),
      });
      const data = await res.json();
      if (data.prompt) {
        setPrompt(data.prompt);
        showToast("✓ Prompt enhanced with cinematic optics.");
      }
    } catch {
      showToast("⚠️ Enhancement service busy.");
    }
  };

  const back = () => {
    const sd = (globalThis as any).samDesktop;
    if (sd?.close) sd.close();
    else {
      window.close();
      setTimeout(() => { if (!window.closed) location.href = "/"; }, 50);
    }
  };

  const filteredStyles = STYLES.filter((s) => {
    if (styleCategory === "ALL") return true;
    if (styleCategory === "CINEMATIC") return s.category === "cinematic";
    if (styleCategory === "NEON") return s.category === "neon";
    if (styleCategory === "MOODY") return s.category === "moody";
    if (styleCategory === "ARTISTIC") return s.category === "artistic";
    return true;
  });

  const playheadRatio = currentTimeSec / TOTAL_DURATION_SEC;

  return (
    <div style={{
      background: "#0D0D0D",
      color: "var(--text)",
      height: "100vh",
      maxHeight: "100vh",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Text', sans-serif",
      boxSizing: "border-box",
      userSelect: "none",
    }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 16, right: 16, zIndex: 9999,
          background: "linear-gradient(135deg, #EDBE7D 0%, #D9A05B 100%)", color: "#111", padding: "10px 16px",
          borderRadius: 8, fontWeight: 700, fontSize: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", gap: 8
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <header style={{
        height: 38, minHeight: 38,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid #222", padding: "0 16px", background: "#141414",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <div onClick={back} title="Close Studio" style={{ width: 11, height: 11, borderRadius: "50%", background: "#FF5F56", cursor: "pointer" }} />
            <div onClick={() => showToast("Studio window minimized")} title="Minimize" style={{ width: 11, height: 11, borderRadius: "50%", background: "#FFBD2E", cursor: "pointer" }} />
            <div onClick={toggleFullscreen} title="Toggle Fullscreen" style={{ width: 11, height: 11, borderRadius: "50%", background: "#27C93F", cursor: "pointer" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#EEE", letterSpacing: "0.5px" }}>SAM Studio Director Pro</span>
        </div>

        {/* Global Timecode Display in Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#0A0A0A", border: "1px solid #282828", padding: "3px 12px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}>
          <span style={{ color: isPlaying ? "#27C93F" : "#D9A05B", fontWeight: 800 }}>{isPlaying ? "● REC" : "■ STBY"}</span>
          <span style={{ color: "#FFF", fontWeight: 700 }}>{formatTimecode(currentTimeSec)}</span>
          <span style={{ color: "#666" }}>/ {formatTimecode(TOTAL_DURATION_SEC)}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "#888" }}>
          <button
            type="button"
            onClick={() => setIsPlaying((p) => !p)}
            style={{
              background: isPlaying ? "#27C93F" : "linear-gradient(135deg, #EDBE7D 0%, #D9A05B 100%)",
              color: "#000", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 800,
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: "0 2px 8px rgba(0,0,0,0.5)"
            }}>
            <Icon name={isPlaying ? "pause" : "play"} size={12} /> {isPlaying ? "PAUSE" : "PLAY (SPACE)"}
          </button>
          <span style={{ cursor: "pointer" }} onClick={() => showToast("Cloud Render Hub Connected (12 nodes ready)")} title="Cloud Render Status">
            <Icon name="cloud" size={14} />
          </span>
          <span style={{ cursor: "pointer", color: theaterMode ? "#D9A05B" : "#888" }} onClick={() => { setTheaterMode(!theaterMode); showToast(theaterMode ? "Director View" : "Cinema Canvas View"); }} title="Toggle Cinema Layout">
            <Icon name="grid" size={14} />
          </span>
        </div>
      </header>

      {/* Main Content Workspace */}
      <div style={{
        display: "grid",
        gridTemplateColumns: theaterMode ? "0px 1fr 0px" : "310px 1fr 280px",
        flex: 1, minHeight: 0, padding: "8px 10px", gap: theaterMode ? "0px" : "10px",
        background: "#0A0A0A", overflow: "hidden", transition: "grid-template-columns 0.3s ease"
      }}>
        {/* LEFT COLUMN: Script, Camera Rig & Lighting Controls */}
        <div style={{
          background: "#141414", borderRadius: 8, border: "1px solid #242424", padding: "12px",
          display: theaterMode ? "none" : "flex", flexDirection: "column", gap: "10px", overflowY: "auto", minHeight: 0
        }}>
          
          {/* Prompt Director */}
          <div style={{ position: "relative", padding: 1, borderRadius: 7, background: "linear-gradient(180deg, rgba(217,160,91,0.2) 0%, rgba(217,160,91,0) 100%)" }}>
            <div style={{ background: "#141414", borderRadius: 6, padding: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.5px", color: "#BBB" }}>AI SCRIPT & PROMPT DIRECTOR</span>
                <button type="button" onClick={handleAutoEnhance} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "#D9A05B", fontSize: 11, fontWeight: 700, textShadow: "0 0 8px rgba(217,160,91,0.4)" }}><Icon name="sparkle" size={12} /> Enhance</span>
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe your scene, camera angle, atmosphere, and action..."
                style={{
                  width: "100%", background: "#080808", border: "1px solid #2A2A2A", borderRadius: 6,
                  padding: "10px 12px", color: "#E8E8E8", fontSize: 11, lineHeight: 1.5, resize: "none", outline: "none", boxSizing: "border-box", height: 84,
                  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.5)"
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#666", marginTop: 6 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 4, height: 4, borderRadius: "50%", background: "#27C93F" }} /> Tokens: ~{Math.round(prompt.length / 4)}</span>
                <span>{prompt.length} chars</span>
              </div>
            </div>
          </div>

          {/* Motion Velocity Keyframe Visualizer */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.5px", color: "#BBB" }}>MOTION VELOCITY CURVE</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#D9A05B" }}>{motionIntensity}%</span>
            </div>
            <div style={{ position: "relative", height: 36, background: "#0A0A0A", border: "1px solid #222", borderRadius: 6, overflow: "hidden", marginBottom: 4 }}>
              {/* Dynamic bezier curve SVG mapping to intensity */}
              <svg width="100%" height="100%" viewBox="0 0 100 36" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
                <path d={`M 0,36 C 30,36 40,${36 - (motionIntensity / 100) * 28} 100,${36 - (motionIntensity / 100) * 32}`} fill="none" stroke="rgba(217,160,91,0.5)" strokeWidth="2" strokeDasharray="4,2" />
                <path d={`M 0,36 C 40,36 50,${36 - (motionIntensity / 100) * 32} 100,${36 - (motionIntensity / 100) * 24}`} fill="none" stroke="#D9A05B" strokeWidth="2" />
                <circle cx="100" cy={36 - (motionIntensity / 100) * 24} r="3" fill="#D9A05B" />
              </svg>
            </div>
            <input
              type="range" min="10" max="100" value={motionIntensity}
              onChange={(e) => setMotionIntensity(Number(e.target.value))}
              style={{ width: "100%", accentColor: "#D9A05B", height: 4, cursor: "pointer", background: "#333", borderRadius: 2, appearance: "none", outline: "none" }}
            />
          </div>

          {/* 8 Comprehensive Higgsfield Camera Movements */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.5px", color: "#BBB" }}>CAMERA MOVEMENT RIGS (8)</span>
              <span style={{ fontSize: 9, color: "#D9A05B", fontWeight: 700 }}>HIGGSFIELD V2</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {MOTIONS.map((m) => {
                const on = motion === m.id;
                return (
                  <button
                    key={m.id} type="button" onClick={() => {
                      setMotion(m.id);
                      showToast(`🎥 Camera set to ${m.label} (${m.desc})`);
                    }}
                    style={{
                      background: on ? "rgba(217,160,91,0.15)" : "#0A0A0A",
                      border: on ? "1px solid #D9A05B" : "1px solid #282828",
                      borderRadius: 6, padding: "6px 8px", color: on ? "#D9A05B" : "#888",
                      fontWeight: 700, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, textAlign: "left"
                    }}>
                    <Icon name={m.icon as any} size={13} />
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span>{m.label}</span>
                      <span style={{ fontSize: 8, color: on ? "#C58D46" : "#555", fontWeight: 500 }}>{m.desc}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Lighting & Aesthetic Matrix */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.5px", color: "#BBB" }}>LIGHTING PRESETS</span>
              <div style={{ display: "flex", gap: 4 }}>
                {["ALL", "CINEMATIC", "NEON", "MOODY"].map((cat) => (
                  <span
                    key={cat}
                    onClick={() => setStyleCategory(cat)}
                    style={{
                      fontSize: 8, fontWeight: 700, cursor: "pointer",
                      padding: "2px 5px", borderRadius: 3,
                      background: styleCategory === cat ? "#D9A05B" : "#222",
                      color: styleCategory === cat ? "#000" : "#888"
                    }}>
                    {cat}
                  </span>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 130, overflowY: "auto" }}>
              {filteredStyles.map((s) => {
                const on = style === s.id;
                return (
                  <div
                    key={s.id} onClick={() => {
                      setStyle(s.id);
                      showToast(`💡 Style set to ${s.label}`);
                    }}
                    style={{
                      cursor: "pointer", background: on ? "rgba(217,160,91,0.12)" : "#0A0A0A",
                      border: on ? "1px solid #D9A05B" : "1px solid #282828",
                      borderRadius: 6, padding: "5px 6px", display: "flex", alignItems: "center", gap: 6
                    }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 4, flexShrink: 0,
                      backgroundImage: `url(/api/studio/preview/${s.id})`, backgroundSize: "cover", backgroundPosition: "center",
                      border: on ? "1px solid #D9A05B" : "1px solid #333"
                    }} />
                    <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                      <span style={{ fontSize: 10, color: on ? "#D9A05B" : "#CCC", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.label}</span>
                      <span style={{ fontSize: 8, color: on ? "#B5803E" : "#666", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.cue}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* CENTER COLUMN: Live Video Viewport & Playback Bar */}
        <div style={{ background: "#141414", borderRadius: 8, border: "1px solid #242424", display: "flex", flexDirection: "column", position: "relative", minHeight: 0, overflow: "hidden" }}>
          
          {/* Main Video Monitor */}
          <div style={{ flex: 1, minHeight: 0, background: "#000", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            
            {/* Active scene rendering */}
            {genUrl ? (
              genUrl.match(/\.(jpeg|jpg|png|webp)$/i) ? (
                <img src={genUrl} alt="Generated scene" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              ) : (
                <video src={genUrl} autoPlay loop controls style={{ width: "100%", height: "100%", objectFit: "contain" }} />
              )
            ) : (
              <div style={{
                position: "absolute", inset: 0,
                backgroundImage: `url(${activeClip?.img || "/api/studio/preview/dusk"})`,
                backgroundSize: "cover", backgroundPosition: "center",
                transition: "background-image 0.3s ease",
                filter: "brightness(0.8) contrast(1.15)"
              }} />
            )}

            {/* Viewfinder Rule-of-Thirds Grid & ARRI Framing Box */}
            {showFraming && (
              <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {/* Rule of Thirds Grid */}
                <div style={{ position: "absolute", inset: "20px", border: "1px solid rgba(255,255,255,0.15)" }}>
                  <div style={{ position: "absolute", left: "33.33%", top: 0, bottom: 0, borderLeft: "1px solid rgba(255,255,255,0.1)" }} />
                  <div style={{ position: "absolute", left: "66.66%", top: 0, bottom: 0, borderLeft: "1px solid rgba(255,255,255,0.1)" }} />
                  <div style={{ position: "absolute", top: "33.33%", left: 0, right: 0, borderTop: "1px solid rgba(255,255,255,0.1)" }} />
                  <div style={{ position: "absolute", top: "66.66%", left: 0, right: 0, borderTop: "1px solid rgba(255,255,255,0.1)" }} />
                  
                  {/* Center Crosshair */}
                  <div style={{ position: "absolute", top: "50%", left: "50%", width: 14, height: 1, background: "rgba(255,255,255,0.4)", transform: "translate(-50%, -50%)" }} />
                  <div style={{ position: "absolute", top: "50%", left: "50%", width: 1, height: 14, background: "rgba(255,255,255,0.4)", transform: "translate(-50%, -50%)" }} />

                  {/* Corner Reticles */}
                  <div style={{ position: "absolute", top: -1, left: -1, width: 16, height: 16, borderTop: "2px solid #FFF", borderLeft: "2px solid #FFF" }} />
                  <div style={{ position: "absolute", top: -1, right: -1, width: 16, height: 16, borderTop: "2px solid #FFF", borderRight: "2px solid #FFF" }} />
                  <div style={{ position: "absolute", bottom: -1, left: -1, width: 16, height: 16, borderBottom: "2px solid #FFF", borderLeft: "2px solid #FFF" }} />
                  <div style={{ position: "absolute", bottom: -1, right: -1, width: 16, height: 16, borderBottom: "2px solid #FFF", borderRight: "2px solid #FFF" }} />
                </div>
              </div>
            )}

            {/* Top Right Motion HUD */}
            <div style={{ position: "absolute", top: 14, right: 14, background: "rgba(10,10,10,0.85)", padding: "6px 12px", borderRadius: 6, backdropFilter: "blur(6px)", border: "1px solid #333" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "#FFF", marginBottom: 2 }}>{MOTIONS.find(m => m.id === motion)?.label || "DOLLY IN"}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontSize: 9, color: "#D9A05B", fontWeight: 700 }}>MOTION RIG</span>
                <div onClick={() => setMotionToggle(!motionToggle)} style={{ width: 24, height: 12, background: motionToggle ? "#D9A05B" : "#444", borderRadius: 6, position: "relative", cursor: "pointer" }}>
                    <div style={{ position: "absolute", top: 2, left: motionToggle ? 14 : 2, width: 8, height: 8, background: "#FFF", borderRadius: "50%", transition: "left 0.2s" }} />
                </div>
              </div>
            </div>

            {/* Bottom Info HUD */}
            <div style={{ position: "absolute", bottom: 12, left: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ fontSize: 10, background: "rgba(0,0,0,0.8)", border: "1px solid #444", padding: "3px 8px", borderRadius: 4, color: "#D9A05B", fontWeight: 800, letterSpacing: "0.5px" }}>
                {activeClip?.name || "Scene Preview"}
              </span>
              <div style={{ display: "flex", gap: 8, fontSize: 9, color: "#AAA", fontWeight: 600, background: "rgba(0,0,0,0.5)", padding: "3px 8px", borderRadius: 4 }}>
                <span>ISO 800</span><span>·</span>
                <span>180°</span><span>·</span>
                <span>5600K</span>
              </div>
            </div>

            <div style={{ position: "absolute", bottom: 12, right: 14, textAlign: "right" }}>
              <div style={{ fontSize: 11, fontWeight: 900, color: "#FFF", letterSpacing: "1.5px", textShadow: "0 2px 4px rgba(0,0,0,0.8)" }}>{activeAspect.id === "2.39:1" ? "ANAMORPHIC" : "SPHERICAL"}</div>
              <div style={{ fontSize: 9, color: "#BBB", fontWeight: 700, textShadow: "0 1px 2px rgba(0,0,0,0.8)" }}>{lens ? `${lens.name.split(" ")[0].toUpperCase()} ${lens.focalLength.toUpperCase()} ${lens.aperture}` : "PANAVISION 40MM T2.0"}</div>
            </div>
          </div>
          
          {/* Interactive Playback Scrub Bar */}
          <div style={{ height: 38, minHeight: 38, padding: "0 14px", display: "flex", alignItems: "center", gap: 12, background: "#121212", borderTop: "1px solid #222" }}>
            <span style={{ fontSize: 11, color: "#D9A05B", fontFamily: "monospace", fontWeight: 700 }}>{formatTimecode(currentTimeSec)}</span>
            
            {/* Scrubber track */}
            <div
              onClick={handleTimelineClick}
              style={{ flex: 1, position: "relative", height: 6, background: "#252525", borderRadius: 3, cursor: "pointer" }}>
              <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${playheadRatio * 100}%`, background: "linear-gradient(90deg, #EDBE7D 0%, #D9A05B 100%)", borderRadius: 3 }} />
              <div style={{ position: "absolute", top: -4, left: `calc(${playheadRatio * 100}% - 7px)`, height: 14, width: 14, background: "#FFF", border: "2px solid #D9A05B", borderRadius: "50%", boxShadow: "0 2px 6px rgba(0,0,0,0.6)" }} />
            </div>

            {/* Transport controls */}
            <div style={{ display: "flex", gap: 10, color: "#888", alignItems: "center" }}>
              <span onClick={handleJumpStart} title="Jump to Start" style={{ fontSize: 13, cursor: "pointer", color: "#AAA" }}>⏮</span>
              <span onClick={() => handleStep(-5)} title="Step Back 5s" style={{ fontSize: 13, cursor: "pointer", color: "#AAA" }}>⏪</span>
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                title={isPlaying ? "Pause" : "Play"}
                style={{
                  background: isPlaying ? "#27C93F" : "linear-gradient(135deg, #EDBE7D 0%, #D9A05B 100%)",
                  border: "none", borderRadius: "50%", width: 26, height: 26, color: "#111",
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.5)"
                }}>
                <Icon name={isPlaying ? "pause" : "play"} size={13} />
              </button>
              <span onClick={() => handleStep(5)} title="Step Forward 5s" style={{ fontSize: 13, cursor: "pointer", color: "#AAA" }}>⏩</span>
              <span onClick={handleJumpEnd} title="Jump to End" style={{ fontSize: 13, cursor: "pointer", color: "#AAA" }}>⏭</span>
            </div>

            <div style={{ display: "flex", gap: 8, color: "#777", marginLeft: "auto" }}>
              <button
                type="button"
                onClick={cycleAspect}
                title="Click to cycle Aspect Ratio"
                style={{ fontSize: 9, cursor: "pointer", color: "#D9A05B", background: "#1E1E1E", border: "1px solid #333", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                {activeAspect.id}
              </button>
              <span style={{ cursor: "pointer", color: showFraming ? "#D9A05B" : "#777" }} onClick={toggleFraming} title="Toggle Viewfinder Overlay">
                <Icon name="frame" size={13} />
              </span>
              <span style={{ cursor: "pointer" }} onClick={toggleFullscreen} title="Toggle Fullscreen">
                <Icon name="screen" size={13} />
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Generation Queue & Scaled Render Settings */}
        <div style={{
          display: theaterMode ? "none" : "flex", flexDirection: "column", gap: "10px", minHeight: 0, overflow: "hidden"
        }}>
          
          {/* Generation Queue */}
          <div style={{ background: "#141414", borderRadius: 8, border: "1px solid #242424", padding: "10px 12px", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.5px", color: "#BBB" }}>GENERATION QUEUE</span>
              <span style={{ cursor: "pointer", color: "#666", fontSize: 10 }} onClick={clearQueue} title="Clear Queue"><Icon name="trash" size={11} /></span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1 }}>
              {isGenerating ? (
                <div style={{ background: "#0A0A0A", border: "1px solid #D9A05B", borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text)" }}>
                    <div style={{ width: 6, height: 6, background: "#D9A05B", borderRadius: "50%" }} /> Rendering ({genProgress}%)
                  </div>
                  <span style={{ color: "#888", cursor: "pointer" }} onClick={() => showToast("Cancel render")}><Icon name="refresh" size={11} /></span>
                </div>
              ) : genUrl ? (
                <div style={{ background: "#0A0A0A", border: "1px solid #27C93F", borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => showToast("Active shot in monitor")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#27C93F", fontWeight: 700 }}>
                    <div style={{ width: 6, height: 6, background: "#27C93F", borderRadius: "50%" }} /> Generated Shot
                  </div>
                  <span style={{ color: "#27C93F" }}><Icon name="check" size={11} /></span>
                </div>
              ) : null}

              {timeline.map((clip) => (
                <div
                  key={clip.id}
                  onClick={() => {
                    setSelectedClipId(clip.id);
                    handleSeek(clip.startSec);
                    showToast(`Loaded ${clip.name}`);
                  }}
                  style={{
                    background: selectedClipId === clip.id ? "rgba(217,160,91,0.1)" : "#0A0A0A",
                    border: selectedClipId === clip.id ? "1px solid #D9A05B" : "1px solid #222",
                    borderRadius: 6, padding: "6px 8px", fontSize: 10, color: "#AAA", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center"
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 5, height: 5, background: selectedClipId === clip.id ? "#D9A05B" : "#555", borderRadius: "50%" }} />
                    <span style={{ color: selectedClipId === clip.id ? "#FFF" : "#AAA", fontWeight: 600 }}>{clip.name}</span>
                  </div>
                  <span style={{ fontSize: 9, color: "#666" }}>{clip.time}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Render Settings Card with Clickable Cycle Pickers */}
          <div style={{ background: "#141414", borderRadius: 8, border: "1px solid #242424", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.5px", color: "#BBB", marginBottom: 2 }}>RENDER SPECIFICATIONS</div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { label: "ENGINE", val: engine, cycle: () => { const next = (engineIndex + 1) % ENGINES.length; setEngineIndex(next); showToast("Engine: " + ENGINES[next]); } },
                { label: "RESOLUTION", val: resolution, cycle: () => { const next = (resIndex + 1) % RESOLUTIONS.length; setResIndex(next); showToast("Resolution: " + RESOLUTIONS[next]); } },
                { label: "FRAME RATE", val: fps, cycle: () => { const next = (fpsIndex + 1) % FRAME_RATES.length; setFpsIndex(next); showToast("FPS: " + FRAME_RATES[next]); } },
                { label: "RUN LOCAL", val: localOnly ? "YES" : "NO", cycle: () => { setLocalOnly(!localOnly); showToast(localOnly ? "Cloud Generation Enabled" : "Local Model Forced"); } }
              ].map((item, i) => (
                <div
                  key={i}
                  onClick={item.cycle}
                  title="Click to cycle option"
                  style={{ cursor: "pointer", background: "#0A0A0A", border: "1px solid #282828", borderRadius: 5, padding: "5px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#BBB", fontSize: 10 }}>
                  <span style={{ fontSize: 9, color: "#666", fontWeight: 700 }}>{item.label}</span>
                  <span style={{ fontWeight: 600, color: "#D9A05B" }}>{item.val.split(" ")[0]} ▾</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{
                width: "100%", marginTop: 6,
                background: isGenerating ? "#333" : "linear-gradient(135deg, #EDBE7D 0%, #D9A05B 100%)",
                color: isGenerating ? "#777" : "#000", border: "none", borderRadius: 6,
                padding: "10px", fontSize: 11, fontWeight: 900, letterSpacing: "0.8px",
                cursor: isGenerating ? "default" : "pointer", boxShadow: isGenerating ? "none" : "0 4px 16px rgba(217,160,91,0.3)"
              }}>
              {isGenerating ? `RENDERING...` : `GENERATE & EXPORT`}
            </button>
          </div>

        </div>
      </div>

      {/* BOTTOM COLUMN: iMovie-Style Multi-Track Magnetic Timeline */}
      <div style={{
        height: 125, minHeight: 125, maxHeight: 125,
        background: "#111111", borderTop: "1px solid #222", padding: "6px 14px",
        display: "flex", gap: "12px", boxSizing: "border-box", overflow: "hidden"
      }}>
        {/* Track Headers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 75, flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#666", fontSize: 10 }}>
            <span style={{ cursor: "pointer", background: "#222", padding: "2px 4px", borderRadius: 3 }} onClick={handleJumpStart} title="Jump to 0:00">↰ 0:00</span>
            <span style={{ cursor: "pointer", color: "#AAA", background: "#222", padding: "2px 4px", borderRadius: 3 }} onClick={duplicateActiveClip} title="Duplicate Selected Clip">
              <Icon name="copy" size={11} />
            </span>
          </div>
          <div style={{ fontSize: 10, color: "#EEE", height: 38, display: "flex", alignItems: "center", gap: 6, fontWeight: 800 }}>
            <span style={{ color: "#D9A05B" }}><Icon name="camera" size={12} /></span> V1
          </div>
          <div style={{ fontSize: 9, color: "#888", height: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 4 }}><span>♫</span> A1</div>
            <div style={{ display: "flex", gap: 2 }}><span style={{ background: "#222", padding: "1px 3px", borderRadius: 2, fontSize: 7, fontWeight: 700, cursor: "pointer" }}>M</span><span style={{ background: "#222", padding: "1px 3px", borderRadius: 2, fontSize: 7, fontWeight: 700, cursor: "pointer" }}>S</span></div>
          </div>
          <div style={{ fontSize: 9, color: "#888", height: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 4 }}><span>♫</span> A2</div>
            <div style={{ display: "flex", gap: 2 }}><span style={{ background: "#222", padding: "1px 3px", borderRadius: 2, fontSize: 7, fontWeight: 700, cursor: "pointer" }}>M</span><span style={{ background: "#222", padding: "1px 3px", borderRadius: 2, fontSize: 7, fontWeight: 700, cursor: "pointer" }}>S</span></div>
          </div>
        </div>

        {/* Timeline Canvas & Scrub Area */}
        <div ref={timelineTrackRef} onClick={handleTimelineClick} style={{ flex: 1, position: "relative", minHeight: 0, cursor: "crosshair" }}>
          
          {/* Time Ruler Markers */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#666", marginBottom: 4, borderBottom: "1px solid #222", paddingBottom: 2 }}>
            <span>0:00</span><span>0:15</span><span>0:30</span><span>0:45</span><span>1:00</span><span>1:15 (End)</span>
          </div>

          {/* Active Glowing Playhead */}
          <div style={{
            position: "absolute", top: 0, left: `${playheadRatio * 100}%`, width: 2, height: "100%",
            background: "#D9A05B", zIndex: 30, pointerEvents: "none", boxShadow: "0 0 8px rgba(217,160,91,0.8)"
          }}>
            <div style={{ position: "absolute", top: 12, left: -4, width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid #D9A05B" }} />
          </div>

          {/* Track 1: Video Clips (iMovie Magnetic Strip) */}
          <div style={{ display: "flex", gap: 4, height: 38, marginBottom: 6 }}>
            {timeline.map((clip) => {
              const isSelected = selectedClipId === clip.id;
              return (
                <div
                  key={clip.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedClipId(clip.id);
                    handleSeek(clip.startSec);
                    showToast(`Selected ${clip.name}`);
                  }}
                  style={{
                    flex: 1, position: "relative", borderRadius: 4, overflow: "hidden",
                    border: isSelected ? "2px solid #D9A05B" : "1px solid #333",
                    backgroundImage: `url(${clip.img})`, backgroundSize: "cover", backgroundPosition: "center",
                    cursor: "pointer", boxShadow: isSelected ? "0 0 10px rgba(217,160,91,0.4)" : "none"
                  }}>
                  <div style={{ position: "absolute", top: 2, left: 4, fontSize: 8, color: "#FFF", background: "rgba(0,0,0,0.7)", padding: "1px 3px", borderRadius: 2, fontWeight: 700 }}>
                    {clip.name.split("·")[0]}
                  </div>
                  <div style={{ position: "absolute", bottom: 2, right: 4, fontSize: 8, color: "#D9A05B", background: "rgba(0,0,0,0.8)", padding: "1px 3px", borderRadius: 2, fontFamily: "monospace" }}>
                    {clip.time}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Track 2: Audio 1 (Dialogue / Score Waveform) */}
          <div style={{ height: 16, background: "rgba(217,160,91,0.08)", borderRadius: 3, marginBottom: 4, display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden" }}>
            {Array.from({ length: 140 }).map((_, i) => {
              const h = isPlaying
                ? Math.max(3, Math.sin((i + currentTimeSec * 10) * 0.4) * 11 + Math.random() * 5)
                : Math.max(2, Math.sin(i * 0.3) * 8 + 3);
              return (
                <div
                  key={i}
                  style={{
                    width: 2, height: h,
                    background: isPlaying ? "#D9A05B" : "#8E6936",
                    margin: "0 1px",
                    opacity: isPlaying ? 0.9 : 0.4,
                    transition: "height 0.1s ease"
                  }}
                />
              );
            })}
          </div>

          {/* Track 3: Audio 2 (SFX / Foley Waveform) */}
          <div style={{ height: 16, background: "rgba(255,255,255,0.04)", borderRadius: 3, display: "flex", alignItems: "center", padding: "0 4px", overflow: "hidden" }}>
            {Array.from({ length: 140 }).map((_, i) => {
              const h = isPlaying
                ? Math.max(2, Math.cos((i + currentTimeSec * 8) * 0.25) * 8 + Math.random() * 4)
                : Math.max(2, Math.cos(i * 0.2) * 6 + 2);
              return (
                <div
                  key={i}
                  style={{
                    width: 2, height: h,
                    background: isPlaying ? "#888888" : "#444444",
                    margin: "0 1px",
                    opacity: isPlaying ? 0.8 : 0.3,
                    transition: "height 0.1s ease"
                  }}
                />
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}
