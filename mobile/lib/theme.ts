// SAM's design tokens, ported for React Native. These are the SAME values as the `:root`
// block in src/styles.css — the pocket has to look like the desk, not like a default RN app.
// Keep them in sync by hand: RN can't read the CSS, so a divergence here shows up as a phone
// that's subtly the wrong shade of SAM. Light + dark mirror the `[data-theme="dark"]` skin.

export type Theme = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentText: string;
  accentSoft: string;
  onAccent: string;
  danger: string;
  ok: string;
};

export const light: Theme = {
  bg: '#FDFBF9',          // warm off-white app background
  surface: '#FFFFFF',     // cards
  text: '#1C1917',        // warm near-black — AAA on bg
  muted: '#78716C',       // secondary text — AA
  border: '#E7E5E4',
  borderStrong: '#D6D3D1',
  accent: '#E8673A',      // terracotta — fills / active
  accentText: '#C2410C',  // darkened — AA for small text on white
  accentSoft: '#FBEDE7',
  onAccent: '#FFFFFF',
  danger: '#EF4444',
  ok: '#22C55E',
};

export const dark: Theme = {
  bg: '#100E0C',
  surface: '#1C1712',
  text: '#F3EDE4',
  muted: '#9A9187',
  border: '#2A221A',
  borderStrong: '#3D3226',
  accent: '#F0824E',
  accentText: '#F9A87A',
  accentSoft: '#2B1A10',
  onAccent: '#FFFFFF',
  danger: '#EF4444',
  ok: '#22C55E',
};

// The type ladder from styles.css (--fs-*), same names, same numbers.
export const fs = {
  micro: 11,
  caption: 12,
  sm: 13,
  md: 14,
  body: 15,
  base: 16,
  lg: 18,
  xl: 22,
  '2xl': 28,
  '3xl': 34,
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32 } as const;
