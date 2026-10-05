// Free Studio shot lane — a still (Pollinations) becomes a playable MP4 via FFmpeg.
// Camera moves are Ken Burns / zoompan, not a branded model. No key required.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { ffmpegPath } from "./render.ts";

const run = promisify(execFile);

export type ShotMotion = {
  rig?: string;
  intensity?: number;
  durationSec?: number;
  width?: number;
  height?: number;
};

function even(n: number): number {
  const v = Math.max(320, Math.min(1440, Math.round(n)));
  return v % 2 === 0 ? v : v + 1;
}

/** Map a Studio camera rig to an FFmpeg zoompan expression. Honest motion, no model names. */
export function zoompanFor(rig: string | undefined, intensity: number, frames: number, width: number, height: number): string {
  const i = Math.min(Math.max(0.2, intensity || 1), 3);
  const step = (0.0012 * i).toFixed(5);
  const zoom = (1 + 0.28 * i).toFixed(3);
  const out = (1.35 + 0.2 * i).toFixed(3);
  const id = (rig || "dolly_in").toLowerCase();
  const size = `s=${width}x${height}:fps=24:d=${frames}`;
  if (/dolly_out|pull/.test(id)) return `zoompan=z='if(eq(on,1),${out},max(zoom-${step},1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${size}`;
  if (/orbit|bullet|360/.test(id)) return `zoompan=z='1.18':x='(iw-iw/zoom)*((on/${frames}))':y='(ih-ih/zoom)/2':${size}`;
  if (/crane|pedestal/.test(id)) return `zoompan=z='1.15':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*((on/${frames}))':${size}`;
  if (/steadicam|tracking/.test(id)) return `zoompan=z='1.12':x='(iw-iw/zoom)*((on/${frames}))':y='(ih-ih/zoom)*0.35':${size}`;
  if (/fpv|dive/.test(id)) return `zoompan=z='min(zoom+${(0.0024 * i).toFixed(5)},${(1.6 + 0.2 * i).toFixed(3)})':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*((on/${frames}))':${size}`;
  if (/vertigo|hitchcock/.test(id)) return `zoompan=z='min(zoom+${(0.0028 * i).toFixed(5)},1.7)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${size}`;
  return `zoompan=z='min(zoom+${step},${zoom})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':${size}`;
}

export function shotDuration(seconds: number | undefined, audioHint?: string): number {
  if (seconds && seconds > 0) return Math.min(20, Math.max(3, seconds));
  const words = audioHint ? audioHint.trim().split(/\s+/).length : 0;
  if (words > 0) return Math.min(20, Math.max(4, Math.round(words / 2.2) + 2));
  return 5;
}

async function speakLocal(text: string, dir: string): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  const out = join(dir, "line.aiff");
  try {
    await run("say", ["-o", out, text.slice(0, 800)], { timeout: 20000 });
    if (existsSync(out) && readFileSync(out).length > 32) return out;
  } catch {
    /* keyed TTS is the next lane — this shot still plays silent */
  }
  return null;
}

export async function renderStillShot(still: Buffer, motion: ShotMotion, audioText?: string): Promise<Buffer> {
  const ff = ffmpegPath();
  if (!ff) throw new Error("FFmpeg is missing — Studio cannot encode a clip on this machine.");
  const width = even(motion.width || 1280);
  const height = even(motion.height || 720);
  const duration = shotDuration(motion.durationSec, audioText);
  const frames = Math.max(24, Math.round(duration * 24));
  const dir = mkdtempSync(join(tmpdir(), "sam-shot-"));
  const stillPath = join(dir, "still.jpg");
  const silent = join(dir, "silent.mp4");
  const final = join(dir, "shot.mp4");
  writeFileSync(stillPath, still);
  const vf = zoompanFor(motion.rig, motion.intensity ?? 1, frames, width, height);
  try {
    await run(ff, [
      "-y", "-loop", "1", "-i", stillPath,
      "-vf", vf,
      "-t", String(duration),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      silent,
    ], { timeout: 60000 });
    const voice = audioText?.trim() ? await speakLocal(audioText.trim(), dir) : null;
    if (voice) {
      await run(ff, [
        "-y", "-i", silent, "-i", voice,
        "-c:v", "copy", "-c:a", "aac", "-shortest",
        "-movflags", "+faststart",
        final,
      ], { timeout: 30000 });
    }
    const out = existsSync(final) ? final : silent;
    const buf = readFileSync(out);
    if (!buf.length) throw new Error("FFmpeg wrote an empty clip");
    return buf;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
