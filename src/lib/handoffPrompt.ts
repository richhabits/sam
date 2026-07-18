/**
 * The handoff prompt.
 *
 * You paste this into ChatGPT / Claude / Gemini — whichever assistant already knows you — and it
 * writes a portable profile you paste back into SAM. SAM's importer then extracts durable facts
 * from it on your own free/local brain and stores them on-device.
 *
 * Why a prompt rather than "export your history": a raw export is tens of thousands of lines of
 * conversation, most of it noise, and every line of it has to be read by a model. This asks the
 * assistant that already knows you to do the summarising — one page instead of a novel, and you
 * can read exactly what you're handing over before you hand it over.
 *
 * The sections map to what SAM ACTUALLY uses, not to a generic "tell me about yourself":
 *   identity + how to speak → the persona system (SAM/PA/Coach/Gran/Mum/Dad/Bestie/Mentor)
 *   brands / businesses     → Business mode and the brand switcher
 *   people                  → the people SAM knows
 *   recurring work          → scheduled tasks and workflows
 *   tools + accounts        → which of SAM's 183 tools are worth wiring
 *   boundaries              → the consent/autonomy model, which is off by default
 *
 * SAFETY, and it is deliberate: the prompt asks for FACTS, never credentials, and SAM's importer
 * treats the pasted text as untrusted data — it will not follow instructions embedded in it.
 * Anyone can read this file to see exactly what is being requested.
 */

export const HANDOFF_PROMPT = `I'm moving to a new personal AI assistant called SAM that runs privately on my own computer. Write me a handover profile so it can pick up where you left off.

Use ONLY what you actually know about me from our conversations. If you don't know something, skip that line — do not guess, and do not pad it out. Write it as plain prose in the third person using my name, in short factual sentences, under these headings:

**Who I am** — my name, what I do, where I'm based (city is enough), how I earn.

**How I like to be spoken to** — direct or warm, brief or detailed, whether I want to be pushed or supported, humour or none, anything that irritates me.

**My work** — the businesses, brands or projects I run, what each one is, and which is the current focus.

**What I'm trying to do** — my live goals and roughly by when, plus anything I've been stuck on or keep putting off.

**How I work** — my routine, when I'm sharp, how I like things organised, my standards, and coding or writing preferences if you know them.

**People** — who comes up regularly (first names and their relationship to me only).

**Recurring jobs** — anything I do repeatedly that a computer could take over: reports, invoices, posts, follow-ups, reviews.

**Tools I actually use** — email, calendar, notes, design, dev, social, accounting.

**Boundaries** — what I'd want an assistant to just do, and what it must always ask me about first.

Do NOT include passwords, API keys, card or bank details, addresses, or anything you'd not want stored in a note. If I ever shared something like that, leave it out entirely.

End with a short paragraph headed **Read me first** giving the three things a new assistant most needs to know to be useful to me on day one.`;

/** One-line summary shown next to the copy button. */
export const HANDOFF_BLURB =
  "Paste this into ChatGPT, Claude or Gemini — whichever already knows you. Paste its answer back here.";
