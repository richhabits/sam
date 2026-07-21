// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — reading what was asked for
//
//  Deciding whether a message means "build something" or is simply conversation.
//  Deliberately a set of rules rather than a model call: it must be free, instant,
//  and provable. Every branch below can be read and argued with, which is not true
//  of a classifier that returns a number nobody can interrogate.
//
//  The asymmetry that shapes all of it: getting this WRONG in one direction costs
//  nothing, and wrong in the other direction is expensive. Treating a build request
//  as chat means SAM answers in words and the person asks again. Treating a chat
//  message as a build request starts a job, writes files and spends money on
//  something nobody asked for. So anything short of clear evidence is conversation,
//  and the yard is never entered on a guess.
// ─────────────────────────────────────────────────────────────

export type Intent = "BUILD_NEW" | "EDIT_EXISTING" | "JOB_STATUS" | "CHAT";

export interface Reading {
  intent: Intent;
  confidence: number;        // 0–1; anything below the bar is read as conversation
  name?: string;             // what to call a new project
  slug?: string;             // which existing project is meant
  what?: string;             // the change asked for, for an edit
}

// Below this, it is conversation. Set high on purpose: the cost of being wrong is
// not symmetric, so the bar for leaving the conversation is a high one.
export const CONFIDENT = 0.75;

// Things a person builds. A request has to name one of these — "build me something
// nice" is not a brief, and guessing at it would produce a job nobody wanted.
const ARTEFACTS = [
  "site", "website", "web site", "page", "landing page", "app", "web app", "webapp",
  "dashboard", "portfolio", "blog", "shop", "store", "api", "form", "booking system",
  "booking site", "microsite", "prototype", "tool", "widget", "calculator", "newsletter",
];

// Asking for something to be MADE. "Build" alone is not enough — "build up", "build a
// relationship", "how do I build muscle" are all ordinary conversation.
const MAKE = /\b(build|make|create|scaffold|spin up|knock up|put together|set up|generate)\b/i;

// Conversation that happens to contain a making word. These are asking ABOUT building,
// not asking FOR a build, and the difference is the whole point.
const ASKING_ABOUT = /\b(how (do|would|can|should) (i|you|we)|what('s| is) the best way|can you explain|what does|why (do|does|is)|tell me about|remind me|what if|should i)\b/i;

// Wanting to know how work in progress is going.
const STATUS = /\b(job status|build status|how('s| is) (the|that|my) (build|job|site|project)|what('s| is) (building|running|in the yard)|any(thing)? building|status of (the|my) (build|job)|is it done|are we done building)\b/i;
const BARE_STATUS = /^\s*(status|jobs?|queue|what('s| is) running)\s*[?.!]*\s*$/i;

// Changing something that already exists.
const CHANGE = /\b(add|change|update|edit|fix|remove|delete|rename|restyle|redesign|tweak|adjust|swap)\b/i;

const JOB_ID = /\bjob_[a-z0-9]+_[a-z0-9]+\b/i;

function mentionedArtefact(text: string): string | null {
  const t = text.toLowerCase();
  // longest first, so "booking site" wins over "site"
  for (const a of [...ARTEFACTS].sort((x, y) => y.length - x.length)) {
    if (new RegExp(`\\b${a.replace(/ /g, "\\s+")}\\b`).test(t)) return a;
  }
  return null;
}

// Turn "build me a booking site for the stud services" into something worth calling a
// project. Strips the request wrapper and keeps the subject.
export function nameFrom(text: string): string {
  let s = String(text || "")
    .replace(/^\s*(please\s+)?(can you|could you|i want you to|i'd like you to|i need you to)\s+/i, "")
    .replace(MAKE, "")
    .replace(/^\s*(me\s+)?(a|an|the)\s+/i, "")
    .replace(/[?!.]+\s*$/, "")
    .trim();
  s = s.replace(/\s+/g, " ").slice(0, 60).trim();
  return s || "new project";
}

// Find which known project a message is about. Matched on the project's own slug and
// name, longest first, so "hello site" beats "hello" when both exist.
export function projectFrom(text: string, known: { slug: string; name: string }[]): string | null {
  const t = text.toLowerCase();
  const candidates = known
    .flatMap((p) => [{ slug: p.slug, token: p.slug.toLowerCase().replace(/-/g, " ") }, { slug: p.slug, token: p.name.toLowerCase() }])
    .filter((c) => c.token.length >= 3)
    .sort((a, b) => b.token.length - a.token.length);
  for (const c of candidates) if (t.includes(c.token)) return c.slug;
  return null;
}

// Is the project mentioned as the THING BEING ADDED TO, rather than just mentioned?
// "a page for the hello site" is an edit; "a one-page hello site" is a description of
// something new that happens to share words with an existing project.
export function boundToProject(text: string, known: { slug: string; name: string }[]): string | null {
  const t = text.toLowerCase();
  for (const p of known) {
    for (const token of [p.slug.toLowerCase().replace(/-/g, " "), p.name.toLowerCase()]) {
      if (token.length < 3) continue;
      if (new RegExp(`\\b(to|for|in|on|into|onto)\\s+(the\\s+|my\\s+)?${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t)) return p.slug;
    }
  }
  return null;
}

export function read(message: string, known: { slug: string; name: string }[] = []): Reading {
  const text = String(message || "").trim();
  if (!text) return { intent: "CHAT", confidence: 1 };

  // ── asking how work is going ──
  if (JOB_ID.test(text) || BARE_STATUS.test(text) || STATUS.test(text)) {
    return { intent: "JOB_STATUS", confidence: 0.9 };
  }

  // A question about how to do something is a conversation, whatever words it uses.
  // Checked BEFORE the build rules, because "how do I build a site" contains every
  // signal a build request has and means the exact opposite.
  if (ASKING_ABOUT.test(text)) return { intent: "CHAT", confidence: 0.9 };

  const slug = projectFrom(text, known);

  // ── changing something that exists ──
  // Requires BOTH a change word and a project it can be pointed at. Without the
  // project there is nothing to edit, and picking one would be a guess.
  if (slug && CHANGE.test(text)) {
    return { intent: "EDIT_EXISTING", confidence: 0.8, slug, what: text };
  }

  // ── making something new ──
  const artefact = mentionedArtefact(text);
  if (MAKE.test(text) && artefact) {
    // A sentence can both ask to make something AND name a project that exists —
    // "build another page FOR the hello site". Only a preposition binding the two
    // makes it an edit. Merely containing the project's name is not enough: "build me
    // a one-page hello site" reads as new, and treating it as an edit would change
    // work that already exists on the strength of a coincidence. Creating a spare
    // project is recoverable; editing the wrong one is not.
    if (slug && boundToProject(text, known)) {
      return { intent: "EDIT_EXISTING", confidence: 0.8, slug, what: text };
    }
    return { intent: "BUILD_NEW", confidence: 0.85, name: nameFrom(text) };
  }

  // Everything else is conversation. Including "build me something amazing", which
  // names nothing that can be built and would otherwise become a job full of guesses.
  return { intent: "CHAT", confidence: 1 };
}

// The single question the chat path asks. Returns null for anything that should carry
// on exactly as it always has — which is most messages, and is what keeps the existing
// behaviour untouched rather than merely similar.
export function routeOrNull(message: string, known: { slug: string; name: string }[] = []): Reading | null {
  const r = read(message, known);
  if (r.intent === "CHAT") return null;
  if (r.confidence < CONFIDENT) return null;   // unsure is the same as conversation
  return r;
}
