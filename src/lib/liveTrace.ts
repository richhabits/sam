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
