// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE CURTAIN — the user sees the performance, never the stage directions.
//
//  A model turn is EITHER a tool call OR a final answer (see the Grammar). A capable brain keeps
//  those apart. A weak one thinks OUT LOUD in the answer slot: "there's a missing piece to be found
//  by running a list_dir tool first — I'll give a clear, immediate answer using only plain text:"
//  and then, finally, the answer. Everything before that colon is SAM's own scaffolding — the tool
//  protocol, the response-format instruction, the deliberation about scope — and it was rendered to
//  the user verbatim (observed 2026-08-12, local llama3.2:3b answering with no cloud keys loaded).
//
//  The Grammar was meant to make this unrepresentable, but it only reaches the brain when the
//  REQUESTED tier is "local"; with no cloud keys the free tier falls through to the same local
//  Ollama UNCONSTRAINED, so the one defence that would have caught this was dark in exactly the
//  configuration a keyless user runs. The Curtain does not depend on the constraint, the tier, or
//  the brain: it is the last thing between a model's text and a human's eyes, so a weak brain
//  degrades to a plain answer rather than to exposed internals.
//
//  It is deliberately a TRIM, not a rewrite. Stage directions are dropped from the OPENING and the
//  CLOSING of an answer, never from the middle — an answer that legitimately discusses SAM's tools
//  ("here are the tools I have: web_search, read_file") must survive untouched, and content inside
//  a code fence is never judged at all. If everything is stage direction there is nothing to show,
//  and the caller says so plainly instead of raising the curtain on the machinery.
// ─────────────────────────────────────────────────────────────

/** What the user gets when a turn produced deliberation and no answer. Honest — it does not
 *  pretend an answer was given, and it does not describe the machinery that failed. */
export const CURTAIN_FALLBACK =
  "I got tangled up working that one out and didn't reach a clean answer — ask me again and I'll have another go.";

// Reasoning the model was never meant to emit at all: an explicit thinking block, or a channel
// marker from a harmony-style template. Removed wherever it appears, opening/middle/closing alike,
// because there is no reading under which this is content.
const THOUGHT_BLOCK = /<(think|thinking|reflection|scratchpad|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1>/gi;
const OPEN_THOUGHT = /<(?:think|thinking|reflection|scratchpad|analysis|reasoning)\b[^>]*>[\s\S]*$/i;  // unclosed — the stream was cut
const CHANNEL_MARKER = /<\|[^|>]*\|>/g;

// A label a model puts in front of the thing it is finally about to say. Harmless, but it is
// protocol vocabulary, not an answer, so the label goes and the answer stays. The "here's a possible
// response:" form came from watching the real local brain answer — it is the model narrating that it
// is now producing output, which is the same throat-clearing in a longer coat.
const ANSWER_LABEL = /^\s*(?:(?:here(?:'|’)?s|here is)\s+(?:a\s+possible\s+|my\s+|the\s+)?)?(?:my\s+)?(?:final\s+answer|answer|response|reply|output)\s*:\s*/i;

// The tool protocol itself, in any of the shapes a model reaches for. Unambiguous: a user-facing
// answer does not contain SAM's call envelope outside a code fence (fences are protected below).
const PROTOCOL_SHAPE = /\{\s*["']?(?:tool|tools|input|respond)["']?\s*:/i;

// Talking about the machinery. Only counts PAIRED with a plan frame — "the tools" appears in a
// perfectly good answer to "what can you do?", and that answer must not be eaten. `plain[\s-]text`
// is hyphen-tolerant because the real brain wrote "a plain-text answer" and the un-hyphenated
// pattern sailed straight past it.
const META_NOUN = /\b(?:tool call|function call|the tools?|a tool|tools? first|available tools?|json (?:object|format|response|only)|the schema|the format (?:above|specified|requested|below)|(?:only |in |using )?plain[\s-]text|out of scope|in scope|missing piece|the system prompt|my instructions|the user'?s? (?:request|question|query)|next step|step \d)\b/i;

// SAM naming its own toolbox as a THING it owns and consults — "an error in my internal tool
// catalog", "the tool registry". This vocabulary has no user-facing reading at all: an answer says
// what SAM can DO, never what its catalogue contains or what state that catalogue is in. Caught by
// running the real brain, which apologised to the user for a fault in its own tool catalogue.
//
// Deliberately narrow. The tempting wider rule — anything about a tool NOT existing — would also
// swallow "I don't have a tool for that", which is an honest and useful answer, not scaffolding.
const SELF_MACHINERY = /\btools?\s+(?:catalog(?:ue)?|registry|inventory|schema|definitions?)\b|\binternal\s+(?:tools?|catalog(?:ue)?|registry|schema|prompt|instructions?)\b/i;

// SAM announcing what SAM is about to do. On its own this is ordinary assistant voice ("I'll check
// the weather"), so it is never enough by itself.
const PLAN_FRAME = /\b(?:I(?:'|’)?ll|I will|I need to|I should|I must|I have to|let me|I(?:'|’)?m going to|I am going to|first,? I|before (?:I|answering)|to answer (?:this|that|the)|in order to)\b/i;

// The verbs that turn a tool NAME into a plan to CALL it. "web_search, read_file" in a list is an
// answer; "by running a list_dir tool first" is a stage direction.
const CALL_VERB = /\b(?:run|runs|running|ran|call|calls|calling|invoke|invoking|use|using|used|need|needs|should|must|first|let me|I(?:'|’)?ll|I will)\b/i;

// A snake_case identifier — how every SAM tool is named. Used only alongside the word "tool" so an
// ordinary answer containing an identifier (a filename, a code symbol) is not mistaken for one.
const SNAKE_IDENT = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Seventeen of SAM's tools are named with an ordinary English word — call, play, music, research,
// translate, speak, click, screenshot, directions… Matching those as bare words turns "here is the
// call shape" and "I'll play you the recording" into "stage directions" and deletes real answers.
// So the registry is split: an underscored name is an IDENTIFIER and unmistakable wherever it
// appears; a single-word name only counts when the word "tool" is sitting right next to it.
interface NameTells { ident: RegExp | null; word: RegExp | null }
const alternation = (ns: string[]) => (ns.length ? ns.map(escapeRe).join("|") : "");

// Memoised on the ARRAY, so a caller that hands over the same list every turn (agent.ts does)
// compiles these once rather than per segment of every answer.
let tellsFor: readonly string[] | null = null;
let tells: NameTells = { ident: null, word: null };
function nameTells(toolNames: readonly string[]): NameTells {
  if (toolNames === tellsFor) return tells;
  const idents = alternation(toolNames.filter((n) => n?.includes("_")));
  const words = alternation(toolNames.filter((n) => n && !n.includes("_")));
  tells = {
    ident: idents ? new RegExp(`\\b(?:${idents})\\b`, "i") : null,
    word: words ? new RegExp(`\\b(?:${words})\\s+tools?\\b|\\btools?\\s+["'\`]?(?:${words})\\b`, "i") : null,
  };
  tellsFor = toolNames;
  return tells;
}

/** Is this segment SAM talking about its own machinery rather than answering?
 *
 *  Three tells, ordered most to least certain. `toolNames` is read at CALL time (the registry grows
 *  at runtime — MCP servers, forged tools), so a tool that did not exist when this module loaded is
 *  still recognised. */
export function isStageDirection(segment: string, toolNames: readonly string[] = []): boolean {
  const s = segment.trim();
  if (!s) return false;

  // 1. The protocol, verbatim, or SAM naming its own toolbox. Nothing else to weigh.
  if (PROTOCOL_SHAPE.test(s) || SELF_MACHINERY.test(s)) return true;

  // 2. A tool named in a frame that plans to CALL it — a registered name, or any snake_case
  //    identifier sitting next to the word "tool". The name alone is not enough: "web_search,
  //    read_file and get_weather" is a perfectly good answer to "what can you do?".
  const { ident, word } = nameTells(toolNames);
  const named = (!!ident && ident.test(s)) || (!!word && word.test(s));
  if ((named || (/\btools?\b/i.test(s) && SNAKE_IDENT.test(s))) && CALL_VERB.test(s)) return true;

  // 3. A plan frame ABOUT the machinery. Either half alone is ordinary prose; together they are
  //    the model narrating its own protocol.
  return PLAN_FRAME.test(s) && META_NOUN.test(s);
}

// ── Segmenting ──────────────────────────────────────────────────────────────
// The leak arrives as one sentence with the answer hanging off the end of it, so a sentence is too
// coarse a unit: "…running a list_dir tool first — I'll give a clear answer using only plain text:
// Assistant apps aren't available…". Splitting on the dash and the colon as well as on sentence
// ends is what lets the answer be rescued from the clause that was hiding it.
const SPLIT = /(\n+|(?<=[.!?…])\s+|\s+[—–]\s+|\s+-\s+|:\s+|;\s+)/;

interface Segment { text: string; sep: string }

function segmentize(text: string): Segment[] {
  const parts = text.split(SPLIT);
  const out: Segment[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = parts[i] ?? "";
    const sep = parts[i + 1] ?? "";
    // A separator with no text before it belongs to the previous segment, or to the leading
    // whitespace we trim anyway — never its own segment, or dropping it would eat real spacing.
    if (!t.trim()) { if (out.length) out[out.length - 1].sep += t + sep; continue; }
    out.push({ text: t, sep });
  }
  return out;
}

const rejoin = (segs: Segment[]): string => segs.map((s) => s.text + s.sep).join("").trim();

// ── Code fences ─────────────────────────────────────────────────────────────
// A fenced block is content, not prose, and must never be judged clause by clause: SAM answers
// coding questions, and an example containing {"tool": …} inside a fence is exactly the answer the
// user asked for. Blocks are lifted out before anything else looks at the text and put back at the
// end. The marker uses bracket characters no model writes and no rule here splits on, so a lifted
// block cannot be broken up or mistaken for prose while it is out of the way.
//
// A fence whose body IS a tool call is the protocol wearing a code block as a disguise — but only
// when it is at an EDGE. Deleting it outright was wrong: it also deleted the answer to "show me the
// call format", where the same JSON is the thing the user asked for. Edge-only is the same rule the
// prose gets, and it separates the two cases exactly — a leaked call arrives alone or tacked on the
// end, an example arrives surrounded by the prose explaining it.
const FENCE = /```[\s\S]*?(?:```|$)/g;
const MARK_OPEN = "⟦FENCE";
const MARK_CLOSE = "⟧";
const MARK_RE = /⟦FENCE(\d+)⟧/g;
const LONE_MARK = /^⟦FENCE(\d+)⟧$/;

function isProtocolFence(block: string): boolean {
  const body = block.replace(/^```[^\n]*\n?/, "").replace(/```\s*$/, "").trim();
  if (!PROTOCOL_SHAPE.test(body)) return false;
  try {
    const o = JSON.parse(body);
    return !!o && typeof o === "object" && (typeof o.tool === "string" || Array.isArray(o.tools) || typeof o.respond === "string");
  } catch { return PROTOCOL_SHAPE.test(body.split("\n")[0] ?? ""); }   // near-JSON the model mangled
}

/** Everything both entry points do before deciding what to drop: protect the fences, delete the
 *  reasoning that is never content, drop a leading protocol label. Returns the prepared prose and
 *  the lifted blocks to put back afterwards. */
function prepare(text: string): { prose: string; fences: string[] } {
  const fences: string[] = [];
  let s = text.replace(FENCE, (block) => {
    fences.push(block);
    return `${MARK_OPEN}${fences.length - 1}${MARK_CLOSE}`;
  });
  s = s.replace(THOUGHT_BLOCK, "").replace(OPEN_THOUGHT, "").replace(CHANNEL_MARKER, "");
  return { prose: s.replace(ANSWER_LABEL, ""), fences };
}

/** The edge test, for prose and lifted fences alike. A segment that is nothing but a fence marker is
 *  judged by what that fence CONTAINS — so a bare tool call in a code block is trimmed at an edge,
 *  while the same block explained by prose around it is left alone. */
function edgeDirection(seg: string, fences: string[], toolNames: readonly string[]): boolean {
  const lone = seg.trim().match(LONE_MARK);
  if (lone) return isProtocolFence(fences[Number(lone[1])] ?? "");
  return isStageDirection(seg, toolNames);
}

/** Put the lifted blocks back, then a second label pass — dropping an opening clause can expose one. */
function restore(kept: string, fences: string[]): string {
  return kept.replace(MARK_RE, (_m, i) => fences[Number(i)] ?? "").replace(ANSWER_LABEL, "").trim();
}

/**
 * Drop stage directions from a model's final answer. Opening and closing only — the middle is left
 * exactly as written. Returns "" when the whole turn was deliberation, so the caller can say that
 * plainly (see CURTAIN_FALLBACK) rather than showing the machinery.
 */
export function curtain(text: string, toolNames: readonly string[] = []): string {
  if (typeof text !== "string" || !text.trim()) return "";
  const { prose, fences } = prepare(text);
  const segs = segmentize(prose);
  let a = 0, b = segs.length;
  while (a < b && edgeDirection(segs[a].text, fences, toolNames)) a++;
  while (b > a && edgeDirection(segs[b - 1].text, fences, toolNames)) b--;
  return restore(rejoin(segs.slice(a, b)), fences);
}

/**
 * The opening only — for the streaming path, where the end of the answer has not been written yet
 * and only the start can be judged. Same rule as `curtain`, minus the closing trim.
 */
export function curtainOpening(text: string, toolNames: readonly string[] = []): string {
  if (typeof text !== "string" || !text.trim()) return "";
  const { prose, fences } = prepare(text);
  const segs = segmentize(prose);
  let a = 0;
  while (a < segs.length && edgeDirection(segs[a].text, fences, toolNames)) a++;
  return restore(rejoin(segs.slice(a)), fences);
}

// A stream has no end to trim from, so the opening is judged as soon as there is enough of it to
// judge: the first clause boundary, or this many characters, whichever comes first. Small enough
// that a user does not wait on it, long enough that a whole opening clause has landed.
const GATE_CAP = 400;
const GATE_BOUNDARY = /[.!?…\n]|\s[—–-]\s|:\s|;\s/;

/**
 * The Curtain for a LIVE stream. Tokens are rendered the instant they arrive, so a `done` event
 * carrying clean text is not enough on its own — the user already read the scaffolding as it typed
 * itself out. The gate holds the opening back until it can be judged, releases what survives, and
 * from then on passes every chunk straight through (the middle of an answer is never trimmed).
 *
 * Feed it chunks in order; it returns the text to emit ("" while still holding). Call `flush()` when
 * the stream ends to release anything the gate is still sitting on.
 */
export function stageGate(toolNames: readonly string[] = []): { push(chunk: string): string; flush(): string } {
  let held = "";
  let open = false;
  const judge = (): string => {
    // The Curtain trims whitespace off what it returns, which is right for a finished answer and
    // wrong mid-stream: the space that ended the held buffer is the space before the NEXT chunk, and
    // losing it welds two sentences together ("your Mac.Nothing leaves it"). Put it back.
    const trailing = held.match(/\s+$/)?.[0] ?? "";
    const kept = curtainOpening(held, toolNames);
    if (!kept) return "";                      // all deliberation so far — keep holding
    open = true;
    held = "";
    return kept + trailing;
  };
  return {
    push(chunk: string): string {
      if (open) return chunk;
      held += chunk;
      if (!GATE_BOUNDARY.test(held) && held.length < GATE_CAP) return "";   // not enough to judge yet
      return judge();
    },
    // End of stream: judge whatever is left. If nothing survives, nothing is emitted — the caller's
    // `done` text (also curtained) is what the user ends up seeing.
    flush(): string {
      if (open) return "";
      const kept = judge();
      held = "";
      return kept;
    },
  };
}
