// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE READER  (`distill`) — turn a web page into clean, model-ready markdown.
//
//  The current cleaner flattens a page to plain text: headings, lists, and links all collapse into
//  one grey run, and site chrome that isn't in a nav/footer tag leaks through. The Reader keeps the
//  STRUCTURE — headings, lists, quotes, inline emphasis, and links become markdown — and then PRUNES
//  the low-signal blocks (a short block that's mostly links is navigation, not content). Model-ready
//  markdown means the model spends its budget on the article, not the menu.
//
//  All SAM's own code, zero dependencies (like the rest of webintel). Static extraction has a real
//  limit, stated not hidden: it reads the HTML as delivered, so a page whose content is drawn by
//  JavaScript after load comes out thin. distill() returns null in that case so the caller falls
//  back LOUDLY to the plain cleaner — never a silent empty result.
// ─────────────────────────────────────────────────────────────

export interface DistillLink { href: string; text: string }
export interface Distilled { title: string; markdown: string; links: DistillLink[] }

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// Inner text of an element with tags removed (used for heading/link/list-item text).
const inlineText = (h: string) => decode(h.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** HTML → clean markdown + title + links, or null when there's too little content to be worth it
 *  (JS-rendered pages, near-empty shells) — the caller then falls back to the plain cleaner. */
export function distill(html: string): Distilled | null {
  if (!html || html.length < 40) return null;
  let h = html;
  const title =
    inlineText(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") ||
    inlineText(h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");

  // Drop the chrome that never carries article content.
  h = h.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|header|nav|footer|form|aside|dialog|template|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ");

  // Prefer the author-declared main region; only adopt it if it holds the bulk of the text (a
  // near-empty <main> is the JS-rendered case — keep the whole document instead).
  const region = h.match(/<main[^>]*>([\s\S]*)<\/main>/i) || h.match(/<article[^>]*>([\s\S]*)<\/article>/i);
  if (region && inlineText(region[1]).length > inlineText(h).length * 0.15) h = region[1];

  const links: DistillLink[] = [];
  // ── to markdown — inline first, so a link inside a heading survives the heading pass ──
  let md = h
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `**${inlineText(inner)}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `*${inlineText(inner)}*`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner) => `\`${inlineText(inner)}\``)
    .replace(/<a[^>]+href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner) => {
      const text = inlineText(inner);
      if (text && href.startsWith("http")) { links.push({ href, text: text.slice(0, 120) }); return `[${text}](${href})`; }
      return text;
    })
    // ── block level ──
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag: string, inner) => `\n\n${"#".repeat(Number(tag[1]))} ${inlineText(inner)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `\n- ${inlineText(inner)}`)
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => `\n\n> ${inlineText(inner)}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|tr|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");   // strip whatever tags remain

  md = decode(md)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  md = prune(md);
  if (inlineText(md).length < 200) return null;   // too little survived → let the caller fall back loudly
  return { title, markdown: md, links: links.slice(0, 100) };
}

// Drop low-signal blocks: a short block that is MOSTLY links is navigation, not content. Prose and
// long link-bearing paragraphs are kept — only the dense little menus go.
function prune(md: string): string {
  return md
    .split(/\n{2,}/)
    .filter((block) => {
      const b = block.trim();
      if (!b) return false;
      const linkChars = (b.match(/\[[^\]]*\]\([^)]*\)/g) || []).join("").length;
      const density = b.length ? linkChars / b.length : 0;
      return !(density > 0.6 && b.length < 400);
    })
    .join("\n\n");
}
