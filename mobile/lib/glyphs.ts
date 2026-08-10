// ONE VOCABULARY OF MARKS, AND ONE RULE THAT GUARDS ALL OF IT.
//
// The rule was already written down and already tested — but only for taskGlyph(), because
// that was the only place glyphs lived when it was written. Settings then grew eight marks of
// its own and the + sheet grew nine more, and every one of those was checked by hand against
// the ranges below. A safety rule that depends on someone remembering to re-run it by hand is
// not a safety rule; it is a habit, and habits do not survive the person who had them.
//
// So the marks live here, named, and the test walks this object rather than one function.
// Adding a glyph anywhere in the app now means adding it here, which means it is checked.
//
// THE RULE. Unicode gives some characters Emoji_Presentation by DEFAULT, and iOS draws those
// full-colour no matter what colour the Text is given — so one such character in a column of
// tinted marks renders as a sticker in a row of ink. `sleep` shipped as ⏱ (U+23F1) and did
// exactly that: measured at chroma 3 against 120–154 for every neighbour. Nothing failed a
// test; it just looked wrong, and only on a device.
//
// U+FE0E (text presentation) does NOT reliably rescue a character inside these ranges on iOS,
// so the rule is to stay out of them entirely rather than decorate a bad choice with a
// selector. FE0E is still used, below, on characters OUTSIDE the ranges that are merely
// emoji-CAPABLE — there it works, and it is why ⚒︎ draws as ink.

/** Ranges Unicode gives Emoji_Presentation by default. Anything here renders in colour on iOS. */
export const EMOJI_DEFAULT_RANGES: [number, number][] = [
  [0x231a, 0x23ff], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653],
  [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
  [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4],
  [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757],
  [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50], [0x2b55, 0x2b55],
];

/**
 * Would iOS draw this string as colour emoji?
 *
 * Exported as a function rather than left in a test file so the rule is available to anything
 * that ever renders a glyph it did not choose itself — a server-supplied kind, say. The test is
 * the main caller today, which is the point: the check and the thing it checks ship together.
 */
export function drawsAsEmoji(glyph: string): boolean {
  for (const ch of glyph) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0e) continue; // the text-presentation selector itself
    if (cp >= 0x1f000) return true; // the emoji planes proper
    for (const [lo, hi] of EMOJI_DEFAULT_RANGES) if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

/** U+FE0E. Built from a code point because an invisible character in a literal is exactly what
 *  an editor or a formatter eats without anyone noticing. */
const TEXT = String.fromCharCode(0xfe0e);

/**
 * Every mark the app draws, by what it MEANS rather than what it looks like.
 *
 * Named by meaning so two screens showing the same idea cannot drift apart — the thing that
 * makes a set of hand-built screens feel like a set of hand-built screens. Grouped by where
 * they are used, but the names are global: `spending` is the spending mark everywhere.
 */
export const GLYPHS = {
  // Settings
  spending: '◈', // white diamond containing black diamond — a token, a thing of value
  connection: '⇄', // rightwards over leftwards arrow — two ends talking
  device: '▣', // white square containing black square — a screen
  sound: '♪',
  test: '✱', // heavy asterisk — a probe, a thing you fire once
  appearance: '◐', // circle with left half black — light and dark
  info: 'ⓘ',
  help: '?',

  // The + sheet, "Attach"
  camera: '◎', // bullseye — a lens
  photos: '▨', // square with upper-right-to-lower-left fill — overlapping frames
  files: '▤', // square with horizontal fill — lines on a page

  // The + sheet, "From SAM"
  skills: '✦', // black four-pointed star — a capability
  playbooks: '▷', // white right-pointing triangle — something you can run
  scheduled: '◷', // circle with upper-right quadrant — elapsing time. Deliberately the SAME
  // mark taskGlyph gives a sleep job, because they are the same idea seen twice.
  // NOT ▦ (crosshatch). Photos is ▨, Files is ▤ and Projects was ▦ — three squares separated
  // only by the DENSITY of their hatching, which at 17pt in a 29pt tile read as the same mark
  // three times. A glyph that does not distinguish its row from its neighbour is doing nothing
  // except adding ink, so these are now separated by shape: diagonal fill, horizontal fill, and
  // a quadrant. Verified on a device, because this is a difference no test can see.
  projects: '◰', // square with upper-left quadrant — a board with work on it
  tools: `⚒${TEXT}`, // hammer and pick, as taskGlyph draws a build
  connector: '◇', // white diamond — a service SAM can reach

  // Jobs. taskGlyph() owns the kind→mark mapping; these are its vocabulary, here so the
  // emoji rule walks them too.
  build: `⚒${TEXT}`,
  create: `✚${TEXT}`,
  edit: `✎${TEXT}`,
  deploy: '↑',
  checkpoint: `⚑${TEXT}`,
  restore: '↺',
  loop: '⟳',
  run: '❯',
  playbookRun: '⇉',
  sleep: '◷',
  notebook: '≡',
  standing: '◉',
  unknown: '▸',
} as const;

export type GlyphName = keyof typeof GLYPHS;
