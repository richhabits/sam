import { useState, useEffect, useRef } from "react";
import { speak as ttsSpeak, stopSpeaking } from "./lib/tts";

// Hands-free two-way voice: SAM greets, listens, you speak, it answers OUT LOUD,
// then listens again — a real back-and-forth. Browser-native, free, cross-platform.
type State = "connecting" | "listening" | "thinking" | "speaking" | "unsupported";

// A greeting with swagger, based on the time of day.
function wakeGreeting(name?: string): string {
  const h = new Date().getHours();
  const n = name ? ` ${name}` : "";
  const morning = [`Morning${n}. What's the mission today?`, `Rise and grind${n} — what we sorting first?`];
  const afternoon = [`What now${n}... what needs doing?`, `Yeah${n}, I'm here — what do you need?`];
  const evening = [`Evening${n}. Everything sorted, or something you need handled?`, `What's good${n}? Say the word.`];
  const night = [`Still up${n}? What do you need?`, `Late one${n} — what's on your mind?`];
  const pool = h < 12 ? morning : h < 17 ? afternoon : h < 22 ? evening : night;
  return pool[Math.floor((Date.now() / 1000) % pool.length)];
}

export default function VoiceMode({ name, ask, onClose }: { name?: string; ask: (q: string) => Promise<string>; onClose: () => void }) {
  const [state, setState] = useState<State>("connecting");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const recRef = useRef<any>(null);
  const active = useRef(true);

  function stopAll() { try { recRef.current?.stop(); } catch {} stopSpeaking(); }

  function speak(text: string, after?: () => void) {
    setState("speaking"); setSaid(text);
    ttsSpeak(text, () => { if (active.current) after?.(); });
  }

  function listen() {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setState("unsupported"); return; }
    const rec = new SR(); recRef.current = rec;
    rec.lang = "en-GB"; rec.interimResults = true; rec.continuous = false;
    setState("listening"); setHeard("");
    let final = "";
    rec.onresult = (e: any) => {
      let t = "";
      for (const r of e.results) { t += r[0].transcript; if (r.isFinal) final += r[0].transcript; }
      setHeard(t);
    };
    rec.onend = () => { if (!active.current) return; const q = final.trim(); if (q) handle(q); else listen(); };
    rec.onerror = () => { if (active.current) setTimeout(() => active.current && listen(), 600); };
    try { rec.start(); } catch {}
  }

  async function handle(q: string) {
    setState("thinking"); setHeard(q);
    let reply = "";
    try { reply = await ask(q); } catch { reply = "Sorry, I didn't catch that — try again."; }
    if (!active.current) return;
    speak(reply, () => active.current && listen());
  }

  useEffect(() => {
    active.current = true;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setState("unsupported"); return; }
    speak(wakeGreeting(name), () => active.current && listen());
    return () => { active.current = false; stopAll(); };
  }, []);

  const label = state === "listening" ? "Listening…" : state === "thinking" ? "Thinking…"
    : state === "speaking" ? "SAM" : state === "unsupported" ? "Voice needs Chrome" : "Connecting…";

  return (
    <div className="vm-wrap">
      <button className="vm-close" onClick={onClose} aria-label="Close voice mode">✕</button>
      <div className={`vm-orb ${state}`}><div className="vm-orb-core" /></div>
      <div className="vm-state">{label}</div>
      <div className="vm-text">{state === "speaking" ? said : heard}</div>
      {state === "unsupported"
        ? <div className="vm-hint">Voice conversation works in Chrome. You can still type in the chat.</div>
        : <button className="vm-end" onClick={onClose}>End voice</button>}
    </div>
  );
}
