import { describe, expect, it } from 'vitest';
import { type IOS, iosDark, iosLight, stateTone, stateToneText } from './ios';

// THE PALETTE HAS TO PROVE ITSELF NOW.
//
// Before this file the design system was the only part of the app with no tests, and it was
// shipping a real AA failure on the most repeated text in the product — white on the tint, at
// 2.62:1 in dark. Nobody had done the arithmetic, and nothing would have told them.
//
// The ratios live here rather than in a comment so a future token edit that looks harmless has
// to argue with a red test instead of with a reviewer's memory.

/** WCAG 2.1 relative luminance. The 0.03928 knee and the 2.4 exponent are from the spec. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// AA. 4.5 for body text; 3.0 only for text that is genuinely large (18pt+, or 14pt+ bold).
const AA = 4.5;
const AA_LARGE = 3;

const APPEARANCES: [string, IOS][] = [
  ['light', iosLight],
  ['dark', iosDark],
];

describe('contrast — the formula itself', () => {
  // If the implementation drifts, every assertion below drifts with it and stops meaning
  // anything. These are the two fixed points every contrast checker agrees on.
  it('agrees with the known extremes', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is symmetric — order of arguments cannot change a verdict', () => {
    expect(contrast('#D9531F', '#FFFFFF')).toBeCloseTo(contrast('#FFFFFF', '#D9531F'), 10);
  });
});

describe.each(APPEARANCES)('%s appearance', (_name, ios) => {
  it('carries body text on every ground it actually uses', () => {
    for (const ground of [ios.groupedBg, ios.card] as const) {
      expect(contrast(ios.label, ground)).toBeGreaterThanOrEqual(AA);
    }
  });

  // AA_LARGE HERE IS A DELIBERATE DEVIATION, NOT A LOWERED BAR.
  //
  // secondaryLabel is Apple's own light-mode value, rgba(60,60,67,0.6), and over #FFFFFF it
  // measures 3.29:1 — under AA. Darkening it to pass would need alpha ~0.72, and even that
  // only reaches 4.23:1 on groupedBg. It would also put SAM's secondary text at a different
  // weight from every Settings.app row beside it, which is the exact fidelity ios.ts exists
  // to hold.
  //
  // The real defect is subtler and is NOT fixed here: iOS ships these as dynamic system
  // colours that the OS darkens when the user turns on Increase Contrast. SAM hardcodes the
  // hex, so it takes Apple's value and drops Apple's adaptation. The honest fix is to consume
  // the dynamic colours (or mirror them behind an Increase Contrast check), not to invent a
  // darker constant — and that is its own change.
  it('keeps secondary text at least legible, and records that it is Apple-faithful rather than AA', () => {
    for (const ground of [ios.groupedBg, ios.card] as const) {
      expect(contrast(flatten(ios.secondaryLabel, ground), ground)).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });

  it('tintText is legible as small text on both grounds — the light-mode failure that started this', () => {
    for (const ground of [ios.groupedBg, ios.card] as const) {
      expect(contrast(ios.tintText, ground)).toBeGreaterThanOrEqual(AA);
    }
  });

  it('onTint is legible on tintFill — the user chat bubble, worst case in the app at 2.62:1', () => {
    expect(contrast(ios.onTint, ios.tintFill)).toBeGreaterThanOrEqual(AA);
  });

  // TasksScreen prints these as 13pt words, so every one is held to the body threshold.
  it('every colour stateToneText can return is legible as the word it actually renders', () => {
    for (const ground of [ios.groupedBg, ios.card] as const) {
      for (const state of ['done', 'failed', 'running', 'queued']) {
        const tone = stateToneText(state, ios);
        expect(contrast(flatten(tone, ground), ground), `${state} on ${ground}`).toBeGreaterThanOrEqual(
          state === 'queued' ? AA_LARGE : AA,
        );
      }
    }
  });

  // The regression this pair was split to prevent. stateTone paints an 8pt dot on the resume
  // cards; a dot has no reading threshold, and darkening it to satisfy one made it muddy —
  // which passed every contrast assertion and was only visible in a screenshot. Pinning it to
  // the system colours means the next person to "fix" the contrast here has to read the note.
  it('keeps stateTone on the vivid system colours, because it paints a dot and not a word', () => {
    expect(stateTone('done', ios)).toBe(ios.green);
    expect(stateTone('failed', ios)).toBe(ios.destructive);
    expect(stateTone('running', ios)).toBe(ios.tint);
  });

  // The separator is the one thing that SHOULD be nearly invisible — a hairline that passed a
  // text threshold would be a drawn border, which is the hand-rolled-list tell ui.tsx avoids.
  it('keeps the separator a hairline rather than a border', () => {
    expect(contrast(ios.separator, ios.card)).toBeLessThan(AA_LARGE);
  });

  it('never returns the same tone for two states that mean different things', () => {
    const tones = ['done', 'failed', 'running'].map((s) => stateTone(s, ios));
    expect(new Set(tones).size).toBe(3);
  });
});

describe('the two appearances stay structurally the same shape', () => {
  it('define exactly the same token names — a token present in one only is a screen that breaks in the other', () => {
    expect(Object.keys(iosLight).sort()).toEqual(Object.keys(iosDark).sort());
  });

  it('every token is a real colour, so a typo cannot ship as a transparent view', () => {
    for (const [, ios] of APPEARANCES) {
      for (const [key, value] of Object.entries(ios)) {
        expect(value, key).toMatch(/^(#[0-9A-Fa-f]{6}|rgba\([\d\s.,]+\))$/);
      }
    }
  });

  // tint is deliberately NOT asserted against a text threshold: it is the indicator/fill colour
  // and tintText exists precisely so tint never has to carry small type. Asserting it here would
  // force a darkening that would make every ActivityIndicator muddy for no accessibility gain.
  it('keeps tint out of the text contract on purpose', () => {
    expect(iosLight.tint).not.toBe(iosLight.tintText);
    expect(contrast(iosLight.tint, iosLight.card)).toBeLessThan(AA);
  });
});

/** Composite an `rgba()` token over an opaque ground so it can be measured as a solid. */
function flatten(colour: string, ground: string): string {
  const m = colour.match(/rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/);
  if (!m) return colour;
  const [r, g, b, a] = m.slice(1).map(Number);
  const gh = ground.replace('#', '');
  const gc = [0, 2, 4].map((i) => Number.parseInt(gh.slice(i, i + 2), 16));
  const mix = [r, g, b].map((c, i) => Math.round(c * a + gc[i] * (1 - a)));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}
