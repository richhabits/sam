// Pure thread bounding, kept away from expo-secure-store for the same reason lib/sse.ts is
// kept away from expo/fetch: a native import makes the module unloadable in the Node test
// runner, so the logic worth testing has to live where the tests can reach it.

export type Stored = { role: 'user' | 'sam'; text: string; route?: string };

export const MAX_TURNS = 40;
export const MAX_CHARS = 12_000;

/**
 * Trim a thread to something a Keychain item can hold, keeping the NEWEST turns — the end of a
 * conversation is the part that still matters. An unbounded write fails silently at the OS
 * layer, which would look like "history randomly stops saving".
 */
export function bound(turns: Stored[]): Stored[] {
  const recent = turns.slice(-MAX_TURNS);
  let total = 0;
  const kept: Stored[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const t = recent[i];
    total += t.text.length;
    if (total > MAX_CHARS) break;
    kept.unshift(t);
  }
  return kept;
}
