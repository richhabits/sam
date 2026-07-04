// SAM speech: uses ElevenLabs (premium voice) when a key is set on the brain,
// otherwise falls back to the free browser voice. Cross-platform.

let current: HTMLAudioElement | null = null;

export function stopSpeaking() {
  try { speechSynthesis.cancel(); } catch {}
  if (current) { try { current.pause(); current.src = ""; } catch {}; current = null; }
}

function clean(text: string) { return text.replace(/[*#`_>\[\]]/g, "").slice(0, 900); }

function browserSpeak(text: string, onDone?: () => void) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-GB";
    u.onend = () => onDone?.();
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch { onDone?.(); }
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
      audio.onended = () => { current = null; onDone?.(); };
      audio.onerror = () => { current = null; browserSpeak(t, onDone); };
      await audio.play();
      return;
    }
  } catch { /* fall through to free voice */ }
  browserSpeak(t, onDone);
}
