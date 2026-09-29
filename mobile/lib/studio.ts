// On-phone image generation. Same free Pollinations lane the desktop studio uses
// (server/routes.studio.ts). No Mac, no API key. The phone asks for the picture
// directly and shows the bytes.

const MAX_PROMPT = 900;
const MIN_EDGE = 256;
const MAX_EDGE = 1024;

export function studioImageUrl(
  prompt: string,
  opts?: { width?: number; height?: number; seed?: number },
): string | null {
  const text = prompt.trim().slice(0, MAX_PROMPT);
  if (!text) return null;
  const width = clampEdge(opts?.width ?? 768);
  const height = clampEdge(opts?.height ?? 768);
  const seed = Number.isFinite(opts?.seed) ? Math.floor(opts!.seed!) : 1;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;
}

function clampEdge(n: number): number {
  if (!Number.isFinite(n)) return 768;
  return Math.min(MAX_EDGE, Math.max(MIN_EDGE, Math.floor(n)));
}
