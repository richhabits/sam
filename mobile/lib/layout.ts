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
//  iPhone Duo's inner display is 669pt wide in portrait, which used to fall in the empty gap
//  between a phone (430) and an iPad (744) and got a stretched phone layout with the hinge
//  through the middle of every row. That width now gets two panes and a 24pt hinge gap.
//
//  Pure and dependency-free on purpose: there is no iPad simulator in the loop here, so the
//  behaviour has to be verifiable by test rather than by eye.
// ─────────────────────────────────────────────────────────────

/** Below this the window behaves like a phone. 640 sits clear of every cover display:
 *  iPhone Pro Max portrait is 430pt, the iPhone Duo cover is 466pt, and an iPad Split View
 *  half is about 507pt. The next real width up is the Duo's inner display at 669pt. */
export const REGULAR_WIDTH = 640;

/** iPhone Duo, from the Xcode 27.1 simulator profile (pixels at 3x). This Mac's Xcode is
 *  26.6 and has no Duo device type, so these widths are the stand-in. The cover matches the
 *  panel. The inner portrait matches App Store Connect's 2007×2853 screenshot, not the
 *  1878×2670 physical panel. Landscape inner is 951pt and overlaps a large iPhone turned
 *  sideways, so it is not detectable by width. */
export const DUO_COVER_WIDTH = 466;
export const DUO_INNER_WIDTH = 669;
export const DUO_HINGE = 24;

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
  /** Specific device tier categorization for granular responsive adapting */
  tier: "compact_phone" | "phone" | "phablet" | "tablet" | "desktop";
  /** Optimal column count for grid layouts on this viewport */
  gridColumns: number;
  /** 2 only on the Duo inner portrait, where a vertical hinge bisects the window. */
  panes: 1 | 2;
  /** Empty band reserved for that hinge. 0 on every other width. */
  hinge: number;
}

export function deviceTierFor(width: number): "compact_phone" | "phone" | "phablet" | "tablet" | "desktop" {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  if (w <= 360) return "compact_phone";
  if (w <= 480) return "phone";
  if (w < REGULAR_WIDTH) return "phablet";
  if (w <= 1024) return "tablet";
  return "desktop";
}

export function layoutFor(width: number): Layout {
  // Guard the nonsense inputs first: width arrives from useWindowDimensions, which can report 0
  // during the first frame and on some orientation changes. Treating 0 as "regular" would flash
  // a tablet layout on every phone launch.
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const isRegular = w >= REGULAR_WIDTH;
  const tier = deviceTierFor(w);
  // Inner portrait only. iPad mini starts at 744, so the band stops short of it.
  const innerFold = w >= 650 && w < 744;

  let gridColumns = 1;
  if (innerFold || tier === "phablet") gridColumns = 2;
  else if (tier === "tablet") gridColumns = 3;
  else if (tier === "desktop") gridColumns = 4;

  return {
    isRegular,
    // Infinity rather than the window width: a phone should let content fill naturally, and a
    // literal cap equal to the width would fight SafeArea padding at the edges.
    contentMaxWidth: isRegular ? READABLE_MAX : Infinity,
    gutter: isRegular ? 32 : 16,
    markSize: isRegular ? 76 : 56,
    tier,
    gridColumns,
    panes: innerFold ? 2 : 1,
    hinge: innerFold ? DUO_HINGE : 0,
  };
}

/** Style for a column that fills a phone and centres itself once there is room to spare.
 *  `width: '100%'` matters: without it a maxWidth-only child shrink-wraps its content and the
 *  centred column jumps around as messages change length. */
/** Home-grid tile width as a % of the content column. Home is a 2×2 on phones; iPad uses the
 *  layout's column count so four tiles sit in a row on a 13" instead of two stretched cards. */
export function tileWidthPercent(columns: number): `${number}%` {
  const c = Math.max(1, Math.min(4, Math.floor(columns) || 1));
  if (c === 1) return '100%';
  if (c === 2) return '47.7%';
  if (c === 3) return '31.4%';
  return '23%';
}

export function contentColumn(l: Layout): { width: '100%'; maxWidth: number; alignSelf: 'center' } {
  return { width: '100%', maxWidth: l.contentMaxWidth, alignSelf: 'center' };
}

/**
 * For a SHORT screen inside a tall window — the pairing form is the only one — centre it
 * vertically instead of leaving it pinned to the top.
 *
 * Capping the width stopped the iPad stretching, but it did not make the iPad look designed: a
 * phone-sized card sat against the top edge with two thirds of a 13-inch screen empty under it,
 * which reads as an iPhone app in a box. That is the same impression Apple rejects builds for,
 * and it is a scroll-container property rather than anything about the content.
 *
 * Only when there is room. On a phone the form is taller than the window and `justifyContent`
 * would fight the scroll, so compact keeps its top alignment and scrolls normally.
 */
export function centreWhenRoomy(l: Layout): { flexGrow?: 1; justifyContent?: 'center' } {
  return l.isRegular ? { flexGrow: 1, justifyContent: 'center' } : {};
}
