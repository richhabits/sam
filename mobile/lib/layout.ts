// ─────────────────────────────────────────────────────────────
//  How wide is the window, and what should that change?
//
//  app.json has claimed `supportsTablet: true` from the start, and NOTHING in the app ever
//  looked at the window size — no useWindowDimensions, no Dimensions, no maxWidth anywhere.
//  Every container is plain flex, so on a 12.9" iPad the layout did not adapt, it STRETCHED:
//  chat text set to a ~1000pt measure, and a pairing form with inputs running the full width of
//  the screen. Apple tests iPad when you claim it, and "an iPhone app blown up" is one of the
//  named reasons they refuse a build. The flag was a liability, not a feature.
//
//  KEYED ON WINDOW WIDTH, NOT ON DEVICE. It is tempting to ask "is this an iPad" and be done,
//  but that answer is wrong half the time on modern iPadOS: an app in Slide Over gets ~320pt
//  and must lay out like a phone, while Split View gives roughly half the screen and lands
//  somewhere between the two. The window is the only thing that tells the truth, and it changes
//  while the app is running — so this takes a width and returns what that width implies.
//
//  Pure and dependency-free on purpose: there is no iPad simulator in the loop here, so the
//  behaviour has to be verifiable by test rather than by eye.
// ─────────────────────────────────────────────────────────────

/** Below this the window behaves like a phone, whatever hardware it is on. 700 sits clear of
 *  both edges: the largest iPhone is 430pt wide, the narrowest iPad in portrait is 744pt. */
export const REGULAR_WIDTH = 700;

/** A column wider than this stops being comfortable to read. Roughly 80–90 characters at the
 *  app's body size — past that the eye loses the start of the next line. */
export const READABLE_MAX = 680;

export interface Layout {
  /** The window is tablet-sized RIGHT NOW — not "the device is an iPad". */
  isRegular: boolean;
  /** Cap for text and forms. Infinity on a phone, where the window is already narrow enough. */
  contentMaxWidth: number;
  /** Horizontal breathing room outside the content column. */
  gutter: number;
  /** Brand mark and other fixed art can afford to grow when there is room. */
  markSize: number;
}

export function layoutFor(width: number): Layout {
  // Guard the nonsense inputs first: width arrives from useWindowDimensions, which can report 0
  // during the first frame and on some orientation changes. Treating 0 as "regular" would flash
  // a tablet layout on every phone launch.
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const isRegular = w >= REGULAR_WIDTH;

  return {
    isRegular,
    // Infinity rather than the window width: a phone should let content fill naturally, and a
    // literal cap equal to the width would fight SafeArea padding at the edges.
    contentMaxWidth: isRegular ? READABLE_MAX : Infinity,
    gutter: isRegular ? 32 : 16,
    markSize: isRegular ? 76 : 56,
  };
}

/** Style for a column that fills a phone and centres itself once there is room to spare.
 *  `width: '100%'` matters: without it a maxWidth-only child shrink-wraps its content and the
 *  centred column jumps around as messages change length. */
export function contentColumn(l: Layout): { width: '100%'; maxWidth: number; alignSelf: 'center' } {
  return { width: '100%', maxWidth: l.contentMaxWidth, alignSelf: 'center' };
}
