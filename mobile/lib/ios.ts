// APPLE'S GRAMMAR, SAM'S TINT.
//
// The pocket started as the desk's CSS tokens transplanted onto a phone: custom cards, a
// custom pill toggle, web type sizes. It read as a website in a phone frame — "very messy",
// correctly. Native iOS apps are not styled that way; they share one structural vocabulary
// (grouped inset lists, large titles, hairline separators, a 17pt body) and express brand
// through ONE thing: the tint colour. So these are Apple's system values, and SAM keeps the
// terracotta as tint — which is what tintColor is for.
//
// Values are the documented iOS system colours (Human Interface Guidelines), not eyeballed
// approximations, so the app sits correctly next to Settings.app in both appearances.

export type IOS = {
  groupedBg: string; // the screen behind grouped content
  card: string; // a grouped list's rows
  cardPressed: string;
  separator: string; // hairline between rows
  label: string;
  secondaryLabel: string;
  tertiaryLabel: string;
  tint: string; // SAM's terracotta — the ONE brand colour in the chrome
  tintPressed: string;
  // THREE TERRACOTTAS, BECAUSE ONE CANNOT DO THREE JOBS AT AA.
  //
  // `tint` is correct for what tintColor is actually for: indicators, glyph fills, the things
  // that carry no text. It is NOT safe as small text, and it is NOT safe under white text.
  // Measured, with the WCAG 2.1 relative-luminance formula:
  //
  //   white on #D9531F ............. 4.03:1  FAILS AA normal (needs 4.5)
  //   white on #F0824E ............. 2.62:1  FAILS AA normal AND AA large (needs 3.0)
  //   #D9531F text on #FFFFFF ...... 4.03:1  FAILS
  //   #D9531F text on #F2F2F7 ...... 3.61:1  FAILS
  //   #F0824E text on #1C1C1E ...... 6.49:1  passes
  //   #F0824E text on #000000 ...... 8.01:1  passes
  //
  // So light mode was failing in both directions and dark mode was failing only under white
  // ink. The user's own chat bubble — the most repeated text in the app — was the worst case
  // at 2.62:1. The desk already learned this and split `--accent` from `--accent-text`
  // (styles.css:14); this is the same split, arrived at the same way, with the numbers kept.
  tintText: string; // tint used as TEXT. Darkened in light; dark already passes, so unchanged.
  tintFill: string; // a tinted SURFACE that carries onTint at AA
  onTint: string; // ink on tintFill — INVERTS by appearance, see below
  destructive: string; // a FILL or a large glyph — see the *Text pair below before using as type
  green: string;
  // stateTone() returns a colour that TasksScreen and the resume cards render as a WORD
  // ("done", "failed") at 13pt. Apple's system green is built to be a fill — a checkmark, a
  // toggle, a dot — and measured as text on a white card it is 2.22:1, on groupedBg 1.99:1.
  // That is not a near miss, it is roughly half of AA and the worst number in the palette.
  // Red is better and still short: 3.55:1 and 3.18:1.
  //
  // Dark mode needs no correction (green 8.42:1 / 10.39:1, red 4.99:1 / 6.16:1) because the
  // same hues sit on near-black. So these two are light-only darkenings, hue and saturation
  // held, and in dark they are simply the system colours again.
  destructiveText: string;
  greenText: string;
  fill: string; // segmented-control track
  // What dims the screen behind a sheet. NOT a constant: 40% black over #F2F2F7 reads as an
  // obvious dimming, and the same 40% over a black background is very nearly nothing — the
  // sheet then has to carry the whole separation on its own edge. Dark goes heavier so that
  // "the thing behind is out of play" is legible in both.
  scrim: string;
};

export const iosLight: IOS = {
  groupedBg: '#F2F2F7',
  card: '#FFFFFF',
  cardPressed: '#D1D1D6',
  separator: '#C6C6C8',
  label: '#000000',
  secondaryLabel: 'rgba(60,60,67,0.6)',
  tertiaryLabel: 'rgba(60,60,67,0.3)',
  tint: '#D9531F',
  tintPressed: '#B8441A',
  // Same hue (16.8°) and saturation as tint, lightness pulled down until both grounds pass:
  // 5.05:1 on card, 4.53:1 on groupedBg. Six lightness points darker than tint and, side by
  // side with it on the same screen, not a colour anyone reads as different.
  tintText: '#BE491B',
  // Three points darker than tint — the least that carries white at AA (4.52:1).
  tintFill: '#CB4E1D',
  onTint: '#FFFFFF',
  destructive: '#FF3B30',
  green: '#34C759',
  destructiveText: '#DE0C00', // 5.05:1 on card, 4.53:1 on groupedBg
  greenText: '#217F39', // 5.05:1 on card, 4.52:1 on groupedBg
  fill: 'rgba(118,118,128,0.12)',
  scrim: 'rgba(0,0,0,0.4)',
};

export const iosDark: IOS = {
  groupedBg: '#000000',
  card: '#1C1C1E',
  cardPressed: '#2C2C2E',
  separator: '#38383A',
  label: '#FFFFFF',
  secondaryLabel: 'rgba(235,235,245,0.6)',
  tertiaryLabel: 'rgba(235,235,245,0.3)',
  tint: '#F0824E',
  tintPressed: '#E0713D',
  // Dark tint is already 6.49:1 on card and 8.01:1 on groupedBg, so text needs no correction.
  tintText: '#F0824E',
  // NOT darkened. Dark-mode accents are lightened on purpose so they read against black;
  // dragging this one down to carry white ink would need a 19-point drop and would leave the
  // dark bubble DARKER than the light one, which is backwards. The fill keeps its brightness
  // and the INK inverts instead — #1C1C1E on #F0824E is 6.49:1, a wider margin than light
  // mode gets. That is the same move Emergent makes on its auth button, whose ink token is
  // maximum-contrast monochrome inverted from the surface rather than a fixed white.
  tintFill: '#F0824E',
  onTint: '#1C1C1E',
  destructive: '#FF453A',
  green: '#30D158',
  destructiveText: '#FF453A', // already 4.99:1 on card, 6.16:1 on groupedBg
  greenText: '#30D158', // already 8.42:1 on card, 10.39:1 on groupedBg
  fill: 'rgba(118,118,128,0.24)',
  scrim: 'rgba(0,0,0,0.6)',
};

// The iOS type ramp, by role rather than by number — so a row's title is `body` because it is
// body text, not because someone picked 17 twice.
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.37 },
  title2: { fontSize: 22, fontWeight: '700' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 17, fontWeight: '400' as const },
  callout: { fontSize: 16, fontWeight: '400' as const },
  subhead: { fontSize: 15, fontWeight: '400' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};

// iOS metrics that are conventions, not choices: 16pt screen margin, 44pt minimum tap target,
// 10pt grouped-list corner radius, and a separator that is a true hairline at any scale.
export const metrics = {
  margin: 16,
  rowMinHeight: 44,
  radius: 10,
  hairline: 0.5,
  // Separators start level with the row's TEXT, not the card edge — the detail that most
  // obviously separates a native list from a hand-rolled one.
  separatorInset: 16,
};

/** What colour a job's state reads as. Lives here rather than in either screen because it is
 *  now used by both the Tasks list and the Agent screen's "pick up where you left off" cards,
 *  and a job that is green in one list and grey in the other is a job the operator has to
 *  re-learn. Unknown states fall back to the muted tone rather than inventing a meaning. */
export function stateTone(state: string | null | undefined, ios: IOS): string {
  switch (state) {
    case 'done':
      return ios.green;
    case 'failed':
      return ios.destructive;
    case 'running':
      return ios.tint;
    default:
      return ios.secondaryLabel;
  }
}

/**
 * The same meanings, in the darker inks that survive being read as WORDS.
 *
 * There are two callers and they are not doing the same thing: TasksScreen prints the state as
 * 13pt text, and the opening screen's resume cards paint it as a 8pt dot. A dot has no reading
 * threshold to meet — it is a coloured shape, and Apple's system green is exactly the right
 * green for it. Text at 13pt on a white card needs 4.5:1, which that green misses by half.
 *
 * Collapsing both into one function was the original mistake, and it was invisible in tests:
 * the text values passed contrast and the dots quietly went muddy, which only a screenshot
 * shows. Same split as tint / tintText, for the same reason.
 */
export function stateToneText(state: string | null | undefined, ios: IOS): string {
  switch (state) {
    case 'done':
      return ios.greenText;
    case 'failed':
      return ios.destructiveText;
    case 'running':
      return ios.tintText;
    default:
      return ios.secondaryLabel;
  }
}
