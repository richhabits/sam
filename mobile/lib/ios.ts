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
  onTint: string;
  destructive: string;
  green: string;
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
  onTint: '#FFFFFF',
  destructive: '#FF3B30',
  green: '#34C759',
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
  onTint: '#FFFFFF',
  destructive: '#FF453A',
  green: '#30D158',
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
