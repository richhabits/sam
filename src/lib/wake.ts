// Hands-free wake — listens on the mic for a WHISTLE or a DOUBLE-CLAP and fires.
// Whistle is a sustained tone (very reliable); clap is a sharp transient.
// Browser-native (Web Audio), works on any laptop, free. Returns stop().

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

  let whistleFrames = 0;
  let lastClap = 0, firstClap = 0, cooldownUntil = 0, raf = 0;

  const fire = () => { const t = performance.now(); if (t < cooldownUntil) return; cooldownUntil = t + 3000; onActivate(); };

  const loop = () => {
    const t = performance.now();

    // ── whistle: a strong, narrow, sustained peak in the whistle band
    analyser.getByteFrequencyData(freq);
    let peak = 0, peakBin = 0, bandAvg = 0;
    for (let i = loBin; i <= hiBin; i++) { bandAvg += freq[i]; if (freq[i] > peak) { peak = freq[i]; peakBin = i; } }
    bandAvg /= (hiBin - loBin + 1);
    const tonal = peak > 165 && peak - bandAvg > 55;   // one bin dominates = a tone
    if (tonal && peakBin >= loBin && peakBin <= hiBin) {
      if (++whistleFrames >= 8) { whistleFrames = 0; fire(); }   // ~130ms sustained
    } else whistleFrames = 0;

    // ── double clap: two loud transients close together
    analyser.getByteTimeDomainData(time);
    let amp = 0;
    for (let i = 0; i < time.length; i++) { const v = Math.abs(time[i] - 128); if (v > amp) amp = v; }
    if (amp > 95 && t - lastClap > 160) {
      lastClap = t;
      if (firstClap && t - firstClap < 900) { firstClap = 0; fire(); }
      else firstClap = t;
    }

    raf = requestAnimationFrame(loop);
  };
  loop();

  return () => {
    cancelAnimationFrame(raf);
    try { src.disconnect(); ctx.close(); } catch {}
    stream.getTracks().forEach((tr) => tr.stop());
  };
}
