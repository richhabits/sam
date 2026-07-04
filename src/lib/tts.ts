// SAM speech: uses ElevenLabs (premium voice) when a key is set on the brain,
// otherwise falls back to the free browser voice. Cross-platform.
//
// Exposes a live "voice level" (0–1) so the UI can give SAM a moving MOUTH:
// real audio amplitude for ElevenLabs, a synthesized talking-wobble for the
// browser voice (which can't be analysed).

let current: HTMLAudioElement | null = null;
let _level = 0;          // live amplitude 0..1
let _speaking = false;
let raf = 0;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let tapped: HTMLAudioElement | null = null;

export function voiceLevel() { return _level; }
export function isSpeaking() { return _speaking; }

function startTicker() {
  if (raf) return;
  const buf = () => (analyser ? new Uint8Array(analyser.frequencyBinCount) : null);
  let data = buf();
  const tick = () => {
    if (analyser) {
      if (!data || data.length !== analyser.frequencyBinCount) data = buf();
      analyser.getByteTimeDomainData(data!);
      let sum = 0;
      for (let i = 0; i < data!.length; i++) { const x = (data![i] - 128) / 128; sum += x * x; }
      _level = Math.min(1, Math.sqrt(sum / data!.length) * 3.2);
    } else if (_speaking) {
      // no audio to analyse (browser voice) → synthesize a natural talking wobble
      const t = performance.now() / 1000;
      _level = 0.3 + 0.32 * Math.abs(Math.sin(t * 7.3)) + 0.22 * Math.abs(Math.sin(t * 13.1 + 1));
    } else {
      _level *= 0.85; if (_level < 0.01) _level = 0;
    }
    if (_speaking || _level > 0.01) raf = requestAnimationFrame(tick);
    else raf = 0;
  };
  raf = requestAnimationFrame(tick);
}

function tapAudio(audio: HTMLAudioElement) {
  try {
    if (tapped === audio) return;
    audioCtx = audioCtx || new ((window as any).AudioContext || (window as any).webkitAudioContext)();
    const src = audioCtx.createMediaElementSource(audio); tapped = audio;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256; analyser.smoothingTimeConstant = 0.75;
    src.connect(analyser); analyser.connect(audioCtx.destination);
    if (audioCtx.state === "suspended") void audioCtx.resume();
  } catch { analyser = null; }   // tap failed → fall back to synthesized wobble
}

export function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch {}
  if (current) { try { current.pause(); current.src = ""; } catch {}; current = null; }
  _speaking = false; analyser = null; tapped = null;
}

function clean(text: string) { return text.replace(/[*#`_>\[\]]/g, "").slice(0, 900); }

function browserSpeak(text: string, onDone?: () => void) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    analyser = null;                     // synthesize the wobble for the mouth
    _speaking = true; startTicker();
    u.onend = () => { _speaking = false; onDone?.(); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { _speaking = false; onDone?.(); }
}

// Speak text. Tries ElevenLabs (/api/speak) first; falls back to browser voice.
export async function speak(text: string, onDone?: () => void) {
  const t = clean(text);
  stopSpeaking();
  try {
    const r = await fetch("/api/speak", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    if (r.ok && (r.headers.get("content-type") || "").includes("audio")) {
      const url = URL.createObjectURL(await r.blob());
      const audio = new Audio(url);
      current = audio;
      audio.onended = () => { current = null; _speaking = false; onDone?.(); };
      audio.onerror = () => { current = null; browserSpeak(t, onDone); };
      await audio.play();
      _speaking = true; tapAudio(audio); startTicker();   // → moving mouth
      return;
    }
  } catch { /* fall through to free voice */ }
  browserSpeak(t, onDone);
}
