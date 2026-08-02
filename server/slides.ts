// ─────────────────────────────────────────────────────────────
//  S.A.M. · SLIDES  — a prompt becomes a deck you can actually present.
//
//  Two halves, deliberately split:
//    • the MODEL half lives in the caller (tools.ts) — it gets the words.
//    • this file gets NO model. buildDeck/renderDeck are pure functions of their input, so the
//      deck can be built, diffed and tested with zero quota spent. Same reasoning as console-view.
//
//  The rendered file is ONE self-contained .html: inline CSS, inline JS, no CDN, no fonts, no
//  fetch. It opens off a USB stick on a conference machine with no wifi, which is the only
//  environment that actually matters when you're about to present. It also prints (⌘P → PDF)
//  without a second code path, because slide-deck exports that need a "PDF mode" always rot.
// ─────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// Resolved at CALL time, not import time. The packaged app sets VAULT_DIR during preboot — after
// this module has been imported — so a top-level const would capture the wrong (in-bundle,
// read-only) path and every save would silently fail. Exactly the env-file.ts bug, not repeated.
function decksDir(): string {
  return join(process.env.VAULT_DIR || join(HERE, "..", "vault"), "decks");
}

export interface Section { title: string; bullets: string[] }
export type SlideKind = "title" | "agenda" | "content" | "closing";
export interface DeckSlide { kind: SlideKind; title: string; subtitle?: string; bullets: string[] }
export interface Deck { title: string; audience?: string; createdAt: string; slides: DeckSlide[] }

// A deck under 4 slides isn't a deck, and past ~30 nobody is presenting it — they're reading a
// document. The clamp is a kindness, not a limitation.
export const MIN_SLIDES = 4;
export const MAX_SLIDES = 30;
export const DEFAULT_SLIDES = 8;

// Hard caps on everything that lands on a slide. A slide is a *billboard*: past these numbers the
// text shrinks below readable at the back of a room, so we truncate rather than render something
// nobody can read. Also the containment against a caller pasting a 40k-char "topic".
const MAX_DECK_TITLE = 120;
const MAX_SLIDE_TITLE = 90;
const MAX_BULLETS = 6;
const MAX_BULLET_CHARS = 180;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Strip the markdown the model insists on emitting even when asked not to, and squash whitespace
// so a bullet that arrived with newlines in it doesn't blow the slide's layout apart.
const clean = (s: string) =>
  s.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

const cap = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** How many SECTIONS a deck of `requested` total slides needs. Two slides are fixed overhead —
 *  the title card and the agenda — and the last section becomes the closing. */
export function sectionCount(requested?: number): number {
  const n = Number(requested);
  const total = Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_SLIDES;
  return Math.max(MIN_SLIDES, Math.min(MAX_SLIDES, total)) - 2;
}

/** Parse a model's outline into sections. Deliberately forgiving: the model is asked for
 *  `## Heading` + `- bullet`, but returns numbered headings, bold headings and trailing-colon
 *  headings often enough that treating any of them as a section is worth the few lines. */
export function parseSections(text: string): Section[] {
  const out: Section[] = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(/^(?:[-*•‣]|\d+[.)])\s+(.+)$/);
    const heading =
      line.match(/^#{1,6}\s+(.+)$/) ||                       // ## Heading
      line.match(/^\*\*(.+?)\*\*:?$/) ||                     // **Heading**
      (!bullet && line.length <= 90 ? line.match(/^(.+?):$/) : null);   // Heading:
    if (heading) { out.push({ title: cap(clean(heading[1]), MAX_SLIDE_TITLE), bullets: [] }); continue; }
    if (bullet && out.length) {
      const b = cap(clean(bullet[1]), MAX_BULLET_CHARS);
      if (b && out[out.length - 1].bullets.length < MAX_BULLETS) out[out.length - 1].bullets.push(b);
    }
  }
  // A numbered list with no headings at all: each item IS a section, otherwise we'd return nothing
  // and throw away a perfectly usable outline.
  if (!out.length) {
    for (const raw of String(text || "").split("\n")) {
      const m = raw.trim().match(/^\d+[.)]\s+(.+)$/);
      if (m) out.push({ title: cap(clean(m[1]), MAX_SLIDE_TITLE), bullets: [] });
    }
  }
  return out.filter((s) => s.title);
}

// The skeleton used when there's no model available (offline, no keys, provider down). Not filler
// for its own sake — it's the shape of nearly every persuasive deck, so the user gets a real
// structure to type into instead of an error message.
const SKELETON: Array<[string, string[]]> = [
  ["Where we are", ["The situation today", "What's already been tried", "What it's costing"]],
  ["The problem", ["Who feels it, and how often", "Why it hasn't been solved", "What happens if nothing changes"]],
  ["Why now", ["What changed recently", "The window, and how long it stays open"]],
  ["The approach", ["The one-sentence idea", "How it works", "Why this and not the alternatives"]],
  ["What it looks like", ["The experience end to end", "The first thing that ships"]],
  ["Evidence", ["What we know", "What we're assuming", "How we'd find out cheaply"]],
  ["Risks", ["The thing most likely to go wrong", "How we'd see it early", "The fallback"]],
  ["Cost and effort", ["What it takes", "What it saves"]],
  ["Timeline", ["First 30 days", "The next milestone"]],
  ["Who does what", ["Owners", "Decisions needed"]],
];

/** A structural deck for `n` sections, always ending in a closing. Topic-aware only in the first
 *  bullet — pretending to know more than we do would be worse than an honest skeleton. */
export function fallbackSections(topic: string, n: number): Section[] {
  const want = Math.max(1, n);
  const out: Section[] = [];
  for (let i = 0; i < want - 1; i++) {
    const [title, bullets] = SKELETON[i % SKELETON.length];
    out.push({ title, bullets: i === 0 ? [`${cap(clean(topic), 90)} — the state of it today`, ...bullets.slice(1)] : [...bullets] });
  }
  out.push({ title: "Next steps", bullets: ["The decision being asked for", "Who owns the next move", "When we check back"] });
  return out;
}

/** Assemble the deck. Pure: same input, same deck, no clock unless you pass one. */
export function buildDeck(opts: { topic: string; sections: Section[]; audience?: string; now?: Date }): Deck {
  const topic = clean(opts.topic || "");
  if (!topic) throw new Error("a deck needs a topic");
  const title = cap(topic, MAX_DECK_TITLE);
  const audience = opts.audience ? cap(clean(opts.audience), 80) : undefined;
  const now = opts.now ?? new Date();

  const sections = opts.sections
    .map((s) => ({ title: cap(clean(s.title || ""), MAX_SLIDE_TITLE), bullets: (s.bullets || []).map((b) => cap(clean(b), MAX_BULLET_CHARS)).filter(Boolean).slice(0, MAX_BULLETS) }))
    .filter((s) => s.title)
    .slice(0, MAX_SLIDES - 2);

  const body = sections.length ? sections : fallbackSections(topic, sectionCount(undefined));

  // The LAST section is the closing — that's the contract with the caller (the prompt asks the
  // model to end on the decision/ask). Doing it this way keeps the slide count exact: sections + 2.
  // Promoting only titles that "look like" an ending was the earlier design and it silently
  // produced one slide more than asked for whenever the model phrased its close differently.
  // A single section is the one case with nothing to spare, so there we append a stock close.
  const closing: Section = body.length > 1
    ? (body.pop() as Section)
    : { title: "Next steps", bullets: [`We covered ${body.map((s) => s.title).join(" · ")}`, "Open questions", "Agree the next action"] };

  const slides: DeckSlide[] = [
    { kind: "title", title, subtitle: audience ? `For ${audience}` : undefined, bullets: [] },
    { kind: "agenda", title: "What we'll cover", bullets: body.map((s) => s.title) },
    ...body.map((s): DeckSlide => ({ kind: "content", title: s.title, bullets: s.bullets })),
    { kind: "closing", title: closing.title, bullets: closing.bullets },
  ];
  return { title, audience, createdAt: now.toISOString(), slides };
}

/** A filename that CANNOT escape the decks folder: everything that isn't [a-z0-9] becomes a dash,
 *  which kills `..`, `/`, `\`, drive letters and NUL in one rule rather than a blocklist that
 *  someone eventually finds a gap in. Date-prefixed so decks sort chronologically. */
export function deckFilename(topic: string, now = new Date()): string {
  const slug = String(topic || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${now.toISOString().slice(0, 10)}-${slug || "deck"}.html`;
}

/** Write the deck under the vault and return its absolute path. Never overwrites: two decks on the
 *  same topic on the same day are usually a revision, and silently eating the first one is the
 *  kind of loss you only notice on stage. */
export function saveDeck(deck: Deck): string {
  const dir = decksDir();
  mkdirSync(dir, { recursive: true });
  const base = deckFilename(deck.title, new Date(deck.createdAt));
  let file = join(dir, base);
  for (let n = 2; existsSync(file) && n < 100; n++) file = join(dir, base.replace(/\.html$/, `-${n}.html`));
  // Belt and braces. deckFilename can't emit a separator today; this asserts it still can't if
  // someone loosens that regex later, rather than trusting a comment to hold the line.
  if (resolve(dirname(file)) !== resolve(dir)) throw new Error("refusing to write a deck outside the vault");
  writeFileSync(file, renderDeck(deck), "utf8");
  return file;
}

/** The slide-by-slide outline SAM prints in chat — the point is that you can judge the deck
 *  without opening it, and only open it when it's already right. */
export function outlineMarkdown(deck: Deck, file: string): string {
  const lines = deck.slides.map((s, i) => {
    const head = `${i + 1}. **${s.title}**${s.kind === "title" ? " — title card" : s.kind === "closing" ? " — closing" : ""}`;
    const body = s.bullets.map((b) => `   - ${b}`).join("\n");
    return body ? `${head}\n${body}` : head;
  });
  return `🎞️ **${deck.title}** — ${deck.slides.length} slides${deck.audience ? ` · for ${deck.audience}` : ""}\n\nSaved to \`${file}\`\n\n${lines.join("\n")}\n\n_One self-contained file — no internet needed. Arrows or space to advance, \`f\` for fullscreen, ⌘P to print or export a PDF. Tell me what to change and I'll rebuild it._`;
}

// ── the renderer ─────────────────────────────────────────────────────────────
// Everything below is one string. No template engine, no build step, no assets: whatever this
// returns IS the deliverable.

const CSS = `
:root{--bg:#faf7f2;--surface:#fff;--text:#1c1712;--muted:#8a8178;--border:#e7e0d6;--accent:#e8673a;--accent-soft:#fbede7}
@media(prefers-color-scheme:dark){:root{--bg:#100e0c;--surface:#1c1712;--text:#f3ede4;--muted:#9a9187;--border:#2a231c;--accent:#f0824e;--accent-soft:#2b1a10}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.deck{height:100%;overflow-y:auto;scroll-snap-type:y mandatory}
.slide{scroll-snap-align:start;min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:7vmin 9vmin;position:relative;border-bottom:1px solid var(--border)}
.inner{width:min(1120px,100%);margin:0 auto}
.eyebrow{color:var(--accent);font-size:clamp(12px,1.4vw,15px);font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-bottom:3vmin}
h1{font-size:clamp(34px,6.4vw,78px);line-height:1.03;letter-spacing:-.035em;margin:0;font-weight:700}
h2{font-size:clamp(24px,3.8vw,46px);line-height:1.1;letter-spacing:-.025em;margin:0;font-weight:650}
h2::after{content:"";display:block;width:72px;height:4px;border-radius:2px;background:var(--accent);margin:2.6vmin 0 0}
.sub{color:var(--muted);font-size:clamp(16px,2.2vw,26px);margin-top:3vmin;max-width:40ch}
.meta{color:var(--muted);font-size:clamp(12px,1.3vw,15px);margin-top:6vmin;letter-spacing:.02em}
ul{list-style:none;margin:4.5vmin 0 0;padding:0;display:flex;flex-direction:column;gap:2.4vmin}
li{position:relative;padding-left:1.5em;font-size:clamp(16px,2.15vw,27px);line-height:1.35;max-width:62ch}
li::before{content:"";position:absolute;left:0;top:.58em;width:.46em;height:.46em;border-radius:50%;background:var(--accent)}
ol{list-style:none;margin:4.5vmin 0 0;padding:0;counter-reset:a;display:flex;flex-direction:column;gap:2.4vmin}
ol li{padding-left:2.2em;counter-increment:a}
ol li::before{content:counter(a,decimal-leading-zero);background:none;color:var(--accent);font-size:.7em;font-weight:700;top:.35em;width:auto;height:auto;letter-spacing:.04em}
.slide.closing{background:var(--accent-soft)}
.num{position:absolute;right:9vmin;bottom:5vmin;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.bar{position:fixed;left:0;bottom:0;height:3px;width:0;background:var(--accent);z-index:9}
.hint{position:fixed;right:14px;top:12px;color:var(--muted);font-size:11px;letter-spacing:.06em;opacity:.55}
@media(max-width:640px){.slide{padding:9vmin 7vmin}li{max-width:none}}
@media(prefers-reduced-motion:reduce){.deck{scroll-behavior:auto}}
/* Print/PDF is the same DOM, not an export path — export paths rot because nobody looks at them.
   Forced light: a full-bleed dark slide is a toner crime and reads worse on paper. */
@media print{
@page{size:landscape;margin:0}
:root{--bg:#fff;--surface:#fff;--text:#111;--muted:#555;--border:#ddd;--accent-soft:#faf1ec}
html,body{height:auto}
.deck{height:auto;overflow:visible;scroll-snap-type:none}
.slide{min-height:0;height:100vh;break-after:page;page-break-after:always;border:0}
.slide:last-child{break-after:auto;page-break-after:auto}
.bar,.hint{display:none}
li,h1,h2{break-inside:avoid}
}`;

// Nav is an ENHANCEMENT, never a requirement: with JS off the deck is still a readable scrolling
// document. Building it the other way (slides hidden until JS shows one) means a blank page on any
// machine that blocks scripts — and a locked-down conference laptop is exactly where that bites.
const JS = `(()=>{
var d=document.querySelector('.deck'),s=[].slice.call(document.querySelectorAll('.slide')),bar=document.querySelector('.bar');
if(!d||!s.length)return;
var at=function(){return Math.round(d.scrollTop/d.clientHeight);};
var go=function(n){var i=Math.max(0,Math.min(s.length-1,n));s[i].scrollIntoView({behavior:'smooth'});};
var paint=function(){bar.style.width=(s.length<2?100:(at()/(s.length-1))*100)+'%';};
addEventListener('keydown',function(e){
var k=e.key;
if(k==='ArrowRight'||k==='ArrowDown'||k==='PageDown'||k===' '){e.preventDefault();go(at()+1);}
else if(k==='ArrowLeft'||k==='ArrowUp'||k==='PageUp'){e.preventDefault();go(at()-1);}
else if(k==='Home'){e.preventDefault();go(0);}
else if(k==='End'){e.preventDefault();go(s.length-1);}
else if(k==='f'||k==='F'){var r=document.documentElement.requestFullscreen;if(r)r.call(document.documentElement);}
});
d.addEventListener('scroll',paint,{passive:true});paint();
})();`;

function slideHtml(s: DeckSlide, index: number, total: number, deck: Deck): string {
  const num = `<div class="num">${index + 1} / ${total}</div>`;
  if (s.kind === "title") {
    const when = deck.createdAt.slice(0, 10);
    return `<section class="slide title">
<div class="inner">
${s.subtitle ? `<div class="eyebrow">${esc(s.subtitle)}</div>` : ""}
<h1>${esc(s.title)}</h1>
<div class="meta">${esc(when)}</div>
</div>${num}</section>`;
  }
  const list = s.bullets.length
    ? s.kind === "agenda"
      ? `<ol>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ol>`
      : `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`
    : "";
  const eyebrow = s.kind === "agenda" ? "Agenda" : s.kind === "closing" ? "Closing" : "";
  return `<section class="slide ${s.kind}">
<div class="inner">
${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ""}
<h2>${esc(s.title)}</h2>
${list}
</div>${num}</section>`;
}

/** The whole deliverable as one string. Pure — no I/O, so it's directly testable (and the test
 *  asserts the self-containment claim rather than trusting it). */
export function renderDeck(deck: Deck): string {
  const total = deck.slides.length;
  const body = deck.slides.map((s, i) => slideHtml(s, i, total, deck)).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(deck.title)}</title><style>${CSS}</style></head>
<body>
<div class="hint">← → to move · f fullscreen</div>
<main class="deck">
${body}
</main>
<div class="bar"></div>
<script>${JS}</script>
</body></html>`;
}
