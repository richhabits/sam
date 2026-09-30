// SAM'S NEW SKIN — the tokens from design_handoff_sam_clients/README.md, transcribed verbatim
// rather than re-derived (the handoff is explicit that every value there is final).
//
// This is now the app's only palette. It replaced the old Apple-style grouped-list kit
// (ui.tsx + lib/ios.ts's iosLight/iosDark) screen by screen; that kit is deleted.
//
// High-fidelity per the handoff: these are the literal values, not approximations.

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export const samColor = {
  ink: '#FDF6EF', // all primary text
  ground: '#0C0A09', // app background
  ground2: '#100D0B', // sidebars, rails
  raise: '#17130F', // cards, rows, tiles
  raise2: '#141110', // sheets, run log
  input: '#1B1613', // text fields, sheet rows
  accent: '#F0824E', // THE only accent — actions, live things
  accentDk: '#D9531F', // gradient end (logo, voice orb)
  accentLt: '#FFA075', // hover
  green: '#30D158', // done, free, safe
  amber: '#FF9F0A', // lane hop, offline, permission, simulated
  red: '#FF453A', // failed, destructive
} as const;

// Text opacity on raised surfaces, per the handoff: 1.0 for anything you must read, .6 support
// copy, .4 machine metadata. RN has no CSS opacity-on-a-token, so these are pre-mixed against
// `raise` (the surface every one of these actually sits on) rather than applied as element
// opacity, which would also fade any icon/border drawn with the same colour.
export const samInk = {
  primary: samColor.ink,
  support: 'rgba(253,246,239,0.6)',
  metadata: 'rgba(253,246,239,0.4)',
};

// Restored from the old lib/ios.ts (iosLightHighContrast/iosDarkHighContrast + paletteFor's
// darkerSystemColors param): a user who turns on Settings ▸ Accessibility ▸ Increase Contrast
// gets a system-wide darkening of dynamic label colours, and copying those as flat constants
// (as `samInk` above does) silently throws that adaptation away. Measured against every
// surface these sit on (ground/ground2/raise/raise2/input): `support` (.6 alpha) already
// clears AA normal text everywhere at 6.6-6.9:1, unchanged; `metadata` (.4 alpha) sits at
// ~3.6:1, under AA normal (needs 4.5) though it clears AA Large — .5 is the smallest alpha
// step that clears 4.5:1 on every surface (4.99-5.06:1), so only `metadata` moves.
const samInkHighContrast = {
  primary: samInk.primary,
  support: samInk.support,
  metadata: 'rgba(253,246,239,0.5)',
};

/** Live, iOS-only, matches useReduceMotion in samKit.tsx: AccessibilityInfo's setting is
 *  dynamic, so a value read once at launch would miss the user toggling it while the app is
 *  running. Android has no equivalent AccessibilityInfo API and resolves false. */
export function useHighContrast(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isDarkerSystemColorsEnabled?.()
      .then((v) => alive && setOn(!!v))
      .catch(() => {
        /* unsupported OS/version — default false */
      });
    const sub = AccessibilityInfo.addEventListener('darkerSystemColorsChanged', (v) => setOn(!!v));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return on;
}

/** The ink tokens for this render: base, or the Increase-Contrast variant. Call once per
 *  component and read `.support`/`.metadata` off the result so the screen re-themes live
 *  when the OS setting changes — `.primary` is identical in both and never needs it. */
export function useInk(): typeof samInk {
  const hc = useHighContrast();
  return hc ? samInkHighContrast : samInk;
}

export const samBorder = {
  default: 'rgba(253,246,239,0.07)',
  emphasis: 'rgba(253,246,239,0.12)',
  accent: 'rgba(240,130,78,0.3)',
};

// Space Grotesk / JetBrains Mono are not yet bundled into the app (no @expo-google-fonts
// package, no expo-font loading in App.tsx) — that's a separate, testable step because a
// missing/mis-registered font family silently falls back to the system font with no error.
// Falling back explicitly here rather than naming a font RN can't find, which would do the
// same thing invisibly.
export const samFont = {
  // "everything a person says or reads"
  display: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
  // "everything a machine says: paths, timings, counts, states, section labels"
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
};

// Scale: 46 / 33 / 27 / 19 / 16 / 14.5 / 13.5 px (Grotesk) · 12.5 / 11 / 10 / 9.5 / 9 px (Mono)
export const samType = {
  display: { fontFamily: samFont.display, fontSize: 46, fontWeight: '700' as const, letterSpacing: -0.03 * 46 },
  h1: { fontFamily: samFont.display, fontSize: 33, fontWeight: '700' as const, letterSpacing: -0.03 * 33 },
  h2: { fontFamily: samFont.display, fontSize: 27, fontWeight: '700' as const, letterSpacing: -0.03 * 27 },
  h3: { fontFamily: samFont.display, fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.03 * 19 },
  rowTitle: { fontFamily: samFont.display, fontSize: 16, fontWeight: '600' as const },
  body: { fontFamily: samFont.display, fontSize: 14.5, fontWeight: '400' as const, lineHeight: 14.5 * 1.5 },
  bodySm: { fontFamily: samFont.display, fontSize: 13.5, fontWeight: '400' as const, lineHeight: 13.5 * 1.5 },
  monoLg: { fontFamily: samFont.mono, fontSize: 12.5 },
  mono: { fontFamily: samFont.mono, fontSize: 11 },
  monoSm: { fontFamily: samFont.mono, fontSize: 10, letterSpacing: 0.1 * 10, textTransform: 'uppercase' as const },
  monoXs: { fontFamily: samFont.mono, fontSize: 9.5, letterSpacing: 0.15 * 9.5, textTransform: 'uppercase' as const },
  label: { fontFamily: samFont.mono, fontSize: 9, letterSpacing: 0.22 * 9, textTransform: 'uppercase' as const },
};

// Gutter 18px everywhere. Rows 8px apart, sections 24-26px, section label 11px above content.
export const samSpace = {
  gutter: 18,
  rowGap: 8,
  section: 25,
  sectionLabel: 11,
  cardPad: 13.5,
  heroPad: 18,
};

export const samRadius = {
  row: 14,
  tile: 13,
  hero: 18,
  sheetTop: 26,
  pill: 999,
  glyph: 9,
};

// Nothing tappable under 44×44.
export const samTouch = { minTarget: 44 };

// 600ms stagger for run-log step reveal, 260ms for sheet rise, 180ms for Yard bar stagger,
// 1.2s offset on the second voice ring — the handoff's own numbers, for callers using
// Animated.timing/stagger instead of re-guessing a duration per screen.
export const samMotion = {
  stepStagger: 600,
  stepRise: 320,
  sheetRise: 260,
  ringOffset: 1200,
  orbPulse: 2200,
  spinnerTurn: 800,
  barStagger: 180,
  toggleKnob: 180,
};

// Same meanings as the old lib/ios.ts stateTone: done -> green, failed -> red, everything else
// muted (running is carried by the spinner, not colour). Shared by the Tasks list and the
// Agent screen's "pick up where you left off" cards so a job can't read as one colour in one
// list and another in the other.
export function stateTone(state: string | null | undefined): string {
  if (state === 'done') return samColor.green;
  if (state === 'failed') return samColor.red;
  return samInk.metadata;
}
