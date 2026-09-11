// Hands-free wake — listens on the mic for a WHISTLE or a DOUBLE-CLAP and fires.
// Whistle is a sustained tone (very reliable); clap is a sharp transient.
// Browser-native (Web Audio), works on any laptop, free. Returns stop().

export type WakeClock = { now: number; whistleFrames: number; lastClap: number; firstClap: number; cooldownUntil: number };

/** Pure detector — same thresholds as the live mic loop, so tests can fire a whistle/clap without a mic. */
export function detectWake(freq: Uint8Array, time: Uint8Array, loBin: number, hiBin: number, clock: WakeClock): boolean {
  let fire = false;
  let peak = 0, peakBin = 0, bandAvg = 0;
  const span = Math.max(1, hiBin - loBin + 1);
  for (let i = loBin; i <= hiBin; i++) { bandAvg += freq[i] || 0; if ((freq[i] || 0) > peak) { peak = freq[i]; peakBin = i; } }
  bandAvg /= span;
  const tonal = peak > 165 && peak - bandAvg > 55;
  if (tonal && peakBin >= loBin && peakBin <= hiBin) {
    clock.whistleFrames += 1;
    if (clock.whistleFrames >= 8) { clock.whistleFrames = 0; fire = true; }
  } else clock.whistleFrames = 0;

  const t = clock.now;
  let amp = 0;
  for (let i = 0; i < time.length; i++) { const v = Math.abs(time[i] - 128); if (v > amp) amp = v; }
  if (amp > 95 && t - clock.lastClap > 160) {
    clock.lastClap = t;
    if (clock.firstClap && t - clock.firstClap < 900) { clock.firstClap = 0; fire = true; }
    else clock.firstClap = t;
  }
  if (fire && t < clock.cooldownUntil) return false;
  if (fire) clock.cooldownUntil = t + 3000;
  return fire;
}

export async function startWakeListener(onActivate: () => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;
  src.connect(analyser);

  const freq = new Uint8Array(analyser.frequencyBinCount);
  const time = new Uint8Array(analyser.fftSize);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const loBin = Math.floor(1000 / binHz);   // whistles ~1–4 kHz
  const hiBin = Math.ceil(4000 / binHz);

  const clock: WakeClock = { now: 0, whistleFrames: 0, lastClap: 0, firstClap: 0, cooldownUntil: 0 };
  let raf = 0;

  const loop = () => {
    clock.now = performance.now();
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(time);
    if (detectWake(freq, time, loBin, hiBin, clock)) onActivate();
    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    cancelAnimationFrame(raf);
    try { src.disconnect(); ctx.close(); } catch { /* best-effort — nothing user-visible depends on this succeeding */ }
    stream.getTracks().forEach((tr) => { tr.stop(); });
  };
}
