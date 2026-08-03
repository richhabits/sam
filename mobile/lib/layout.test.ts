import { describe, expect, it } from 'vitest';
import { centreWhenRoomy, contentColumn, layoutFor, READABLE_MAX, REGULAR_WIDTH } from './layout';

// There is no iPad in this loop, so the iPad behaviour is pinned here instead of eyeballed.
// The widths below are the real ones — if a case regresses, it regresses against an actual
// device size rather than a made-up number.

const IPHONE_SE = 375;
const IPHONE_PRO_MAX = 430;
const IPAD_MINI_PORTRAIT = 744;
const IPAD_11_PORTRAIT = 834;
const IPAD_129_LANDSCAPE = 1366;
const SLIDE_OVER = 320;      // an iPad app pushed into the narrow overlay
const SPLIT_HALF = 507;      // roughly half of an 11" iPad in landscape

describe('what counts as a phone', () => {
  it('treats every iPhone width as compact', () => {
    for (const w of [IPHONE_SE, IPHONE_PRO_MAX]) {
      expect(layoutFor(w).isRegular).toBe(false);
      expect(layoutFor(w).contentMaxWidth).toBe(Infinity);
    }
  });

  it('treats every iPad width as regular', () => {
    for (const w of [IPAD_MINI_PORTRAIT, IPAD_11_PORTRAIT, IPAD_129_LANDSCAPE]) {
      expect(layoutFor(w).isRegular).toBe(true);
      expect(layoutFor(w).contentMaxWidth).toBe(READABLE_MAX);
    }
  });

  it('follows the WINDOW, not the hardware — Slide Over and Split View lay out like a phone', () => {
    // The case a device check gets wrong. An iPad in Slide Over is ~320pt: asking "is this an
    // iPad" says yes and produces a tablet layout inside a sliver of a window.
    expect(layoutFor(SLIDE_OVER).isRegular).toBe(false);
    expect(layoutFor(SPLIT_HALF).isRegular).toBe(false);
  });

  it('switches exactly at the breakpoint, not around it', () => {
    expect(layoutFor(REGULAR_WIDTH - 1).isRegular).toBe(false);
    expect(layoutFor(REGULAR_WIDTH).isRegular).toBe(true);
  });
});

describe('the degenerate widths that actually happen', () => {
  it('does not flash a tablet layout when the width is not known yet', () => {
    // useWindowDimensions reports 0 on the first frame and during some rotations. If 0 read as
    // regular, every phone launch would flicker through an iPad layout.
    for (const w of [0, -1, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(layoutFor(w as number).isRegular).toBe(false);
    }
  });

  it('survives an absurd width without inventing an absurd column', () => {
    expect(layoutFor(100_000).contentMaxWidth).toBe(READABLE_MAX);
  });
});

describe('the content column', () => {
  it('fills a phone', () => {
    const c = contentColumn(layoutFor(IPHONE_PRO_MAX));
    expect(c.maxWidth).toBe(Infinity);
    expect(c.width).toBe('100%');
  });

  it('centres and caps itself on an iPad', () => {
    const c = contentColumn(layoutFor(IPAD_129_LANDSCAPE));
    expect(c.maxWidth).toBe(READABLE_MAX);
    expect(c.alignSelf).toBe('center');
  });

  it('always sets width 100% so the column cannot shrink-wrap its contents', () => {
    // Without this a capped column hugs whatever is inside it, and a centred chat visibly
    // jumps left and right as message lengths change.
    for (const w of [IPHONE_SE, IPAD_11_PORTRAIT]) {
      expect(contentColumn(layoutFor(w)).width).toBe('100%');
    }
  });

  it('gives an iPad more gutter and a bigger mark than a phone', () => {
    expect(layoutFor(IPAD_11_PORTRAIT).gutter).toBeGreaterThan(layoutFor(IPHONE_SE).gutter);
    expect(layoutFor(IPAD_11_PORTRAIT).markSize).toBeGreaterThan(layoutFor(IPHONE_SE).markSize);
  });
});

describe('using the space, not just capping it', () => {
  it('centres a short screen vertically once the window is tall enough', () => {
    // Capping the width stopped the iPad stretching; it did not stop the card sitting against
    // the top edge with two thirds of the screen empty under it, which is what an iPhone app in
    // a box looks like.
    expect(centreWhenRoomy(layoutFor(IPAD_11_PORTRAIT))).toEqual({ flexGrow: 1, justifyContent: 'center' });
  });

  it('leaves a phone alone — there the form is taller than the window', () => {
    // justifyContent on a scroll container whose content overflows fights the scroll.
    expect(centreWhenRoomy(layoutFor(IPHONE_SE))).toEqual({});
    expect(centreWhenRoomy(layoutFor(SLIDE_OVER))).toEqual({});
  });
});
