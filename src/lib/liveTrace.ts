/** Shown the instant a turn starts — never a blank thinking bubble while the free lane warms. */
export const STARTING_STEP = "Starting on a free lane…";

export function seedLiveTrace(): string[] {
  return [STARTING_STEP];
}

/** Real tool steps replace the placeholder so the HUD is the journey, not a stuck spinner. */
export function appendToolTrace(trace: string[] | undefined, activity: string): string[] {
  const prev = (trace || []).filter((s) => s !== STARTING_STEP);
  return [...prev, activity];
}

/** Keep only real tool steps on a finished turn — never the warm-up placeholder. */
export function persistToolTrace(server: string[] | undefined, live: string[] | undefined): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const step of [...(server || []), ...(live || [])]) {
    if (!step || step === STARTING_STEP || seen.has(step)) continue;
    seen.add(step);
    out.push(step);
  }
  return out.length ? out : undefined;
}
