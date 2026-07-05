import { useState, useEffect, useRef } from "react";
import { speak as ttsSpeak, stopSpeaking, voiceLevel } from "./lib/tts";

type State = "connecting" | "listening" | "thinking" | "speaking" | "unsupported" | "blocked";

function wakeGreeting(name?: string): string {
  const h = new Date().getHours();
  const n = name ? ` ${name}` : "";
  const pool = h < 12 ? [`Morning${n}. What's the mission today?`] : h < 17 ? [`What now${n}?`] : [`Evening${n}. Say the word.`];
  return pool[0];
}

export default function VoiceMode({ name, ask, onClose }: { name?: string; ask: (q: string) => Promise<string>; onClose: () => void }) {
  const [state, setState] = useState<State>("connecting");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const active = useRef(true);
  const mouthRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<State>(state);
  
  // Realtime WebRTC refs
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);   // getUserMedia stream — must be stopped on teardown

  // Fallback refs
  const recRef = useRef<any>(null);

  useEffect(() => { stateRef.current = state; }, [state]);

  // Visuals loop
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const el = mouthRef.current;
      if (el) {
        const s = stateRef.current; const now = performance.now();
        let v = 0;
        if (s === "speaking") v = voiceLevel();
        else if (s === "listening") v = 0.12 + 0.09 * Math.abs(Math.sin(now / 360));
        else if (s === "thinking") v = 0.10 + 0.12 * Math.abs(Math.sin(now / 220));
        el.style.setProperty("--v", v.toFixed(3));
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  function stopAll() {
    try { recRef.current?.stop(); } catch {}
    stopSpeaking();
    pcRef.current?.close();
    // Closing the RTCPeerConnection does NOT stop the mic track — kill it explicitly
    // so the browser's recording indicator turns off.
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    micStreamRef.current = null;
  }

  // ── OPENAI REALTIME WEBRTC ──
  async function initWebRTC() {
    try {
      // 1. Get ephemeral token from backend
      const res = await fetch("http://localhost:8787/api/voice/token").catch(() => null);
      if (!res || !res.ok) throw new Error("No token");
      const { client_secret: { value: token } } = await res.json();

      // 2. Setup WebRTC
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = e => { audioEl.srcObject = e.streams[0]; };

      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = ms;
      pc.addTrack(ms.getTracks()[0]);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "response.audio_transcript.delta") {
          setState("speaking");
          setSaid(prev => prev + msg.delta);
        }
        if (msg.type === "response.audio_transcript.done") {
           setState("listening");
        }
        if (msg.type === "conversation.item.input_audio_transcription.completed") {
           setHeard(msg.transcript);
           setState("thinking");
           setSaid("");
        }
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`, {
        method: "POST",
        body: offer.sdp,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" }
      });
      if (!sdpResponse.ok) throw new Error("SDP failed");

      const answer = { type: "answer" as const, sdp: await sdpResponse.text() };
      await pc.setRemoteDescription(answer);

      setState("listening");
    } catch (e: any) {
      // Mic blocked / no device → show a clear BLOCKED state; do NOT loop trying.
      if (e?.name === "NotAllowedError" || e?.name === "SecurityError" || e?.name === "NotFoundError") { setState("blocked"); return; }
      console.warn("WebRTC Realtime failed, falling back to legacy...", e);
      fallbackInit();
    }
  }

  // ── LEGACY FALLBACK ──
  function fallbackSpeak(text: string, after?: () => void) {
    setState("speaking"); setSaid(text);
    ttsSpeak(text, () => { if (active.current) after?.(); });
  }

  function fallbackListen() {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setState("unsupported"); return; }
    const rec = new SR(); recRef.current = rec;
    rec.lang = "en-GB"; rec.interimResults = true; rec.continuous = false;
    setState("listening"); setHeard("");
    let final = "", blocked = false;
    rec.onresult = (e: any) => {
      let t = "";
      for (const r of e.results) { t += r[0].transcript; if (r.isFinal) final += r[0].transcript; }
      setHeard(t);
    };
    rec.onerror = (e: any) => {
      const err = e?.error;
      // Blocked / no mic → STOP (no retry loop, no fake "listening").
      if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture") { blocked = true; setState("blocked"); }
      // "no-speech"/"network"/"aborted" are transient — onend re-listens.
    };
    rec.onend = () => { if (!active.current || blocked) return; const q = final.trim(); if (q) fallbackHandle(q); else fallbackListen(); };
    try { rec.start(); } catch { setState("blocked"); }
  }

  async function fallbackHandle(q: string) {
    setState("thinking"); setHeard(q);
    let reply = "";
    try { reply = await ask(q); } catch { reply = "Sorry, I didn't catch that — try again."; }
    if (!active.current) return;
    fallbackSpeak(reply, () => active.current && fallbackListen());
  }

  function fallbackInit() {
    fallbackSpeak(wakeGreeting(name), () => active.current && fallbackListen());
  }

  useEffect(() => {
    active.current = true;
    initWebRTC();
    return () => { active.current = false; stopAll(); };
  }, []);

  const label = state === "listening" ? "Listening…" : state === "thinking" ? "Thinking…"
    : state === "speaking" ? "SAM" : state === "blocked" ? "Mic blocked" : state === "unsupported" ? "Voice needs Chrome" : "Connecting…";

  return (
    <div className="vm-wrap">
      <button className="vm-close" onClick={onClose} aria-label="Close voice mode">✕</button>
      <div className={`vm-orb ${state}`} ref={mouthRef}>
        <div className="vm-mouth">
          {[0.5, 0.78, 1, 0.78, 0.5].map((m, i) => (
            <span key={i} className="vm-bar" style={{ ["--m" as any]: m }} />
          ))}
        </div>
      </div>
      <div className="vm-state">{label}</div>
      <div className="vm-text">{state === "speaking" ? said : heard}</div>
      {state === "blocked"
        ? <div className="vm-hint">🎤 Your mic is blocked. Click the 🔒/camera icon in the address bar → <b>Always allow</b> the microphone → reopen Voice. You can always type in the chat instead.</div>
        : state === "unsupported"
        ? <div className="vm-hint">Voice conversation works in Chrome. You can still type in the chat.</div>
        : <button className="vm-end" onClick={onClose}>End voice</button>}
    </div>
  );
}
