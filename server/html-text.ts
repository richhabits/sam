// ─────────────────────────────────────────────────────────────
//  S.A.M. · HTML → PLAIN TEXT
//
//  Two helpers for reducing scraped markup to text. They exist because the one-line regex
//  versions are each wrong in a way CodeQL names:
//
//   · `h.replace(/<[^>]+>/g, "")` is an INCOMPLETE multi-character sanitisation. Removing a tag can
//     weld the pieces either side of it into a NEW tag ("<scr<b>ipt>" → "<script>"), and a "<"
//     with no closing ">" is never matched at all. It is also quadratic on a long run of "<"s.
//   · `.replace(/&amp;/g, "&").replace(/&quot;/g, '"')` run in sequence DOUBLE-UNESCAPES:
//     "&amp;quot;" is the literal text `&quot;`, but the second pass turns it into `"`.
//
//  stripTags scans once with indexOf (linear) and its output contains no "<" at all, so nothing
//  it returns can be read as markup. decodeEntities decodes in a SINGLE pass, so a decoded "&"
//  is never looked at again.
// ─────────────────────────────────────────────────────────────

/** Remove everything from a "<" to the next ">". A "<" that never closes is dropped along with
 *  any other "<" after it. The result never contains "<". */
export function stripTags(input: string): string {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const lt = input.indexOf("<", i);
    if (lt < 0) { out += input.slice(i); break; }
    out += input.slice(i, lt);
    const gt = input.indexOf(">", lt + 1);
    if (gt < 0) {
      // Unterminated tag: no ">" exists beyond this point, so drop the "<" characters and keep
      // the text. One pass, no rescanning.
      out += input.slice(lt + 1).replace(/</g, "");
      break;
    }
    i = gt + 1;
  }
  return out;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&#x27;": "'", "&quot;": '"' };

/** Decode the handful of entities search-result HTML uses, in one pass. */
export function decodeEntities(input: string): string {
  return input.replace(/&(?:amp|quot|#x27);/g, (m) => ENTITIES[m]);
}
