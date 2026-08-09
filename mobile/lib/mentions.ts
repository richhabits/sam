// @-REFERENCES — pointing SAM at a task you already ran.
//
// The pocket's answer to the thing every modern editor has: type `@`, pick something you did
// before, and the next message carries it. On a phone this matters MORE than on the desk,
// because the alternative is thumbing out "remember that build that failed on mainline, the
// one about the opening-hours gate…" — which is the whole reason people stop using an
// assistant away from their Mac.
//
// Everything here is pure string work, kept out of ChatScreen.tsx for the same reason
// lib/thread.ts is kept out of lib/history.ts: a module that imports a native module cannot be
// loaded by the Node test runner, and the part worth testing is exactly this part. The screen
// owns the fetching and the pixels; this file owns "is that an @ or is that an email address".

/** The shape /api/yard hands back in `recent` — the same rows the Tasks surface renders. */
export type RecentTask = {
  id: string;
  kind: string;
  payload?: { name?: string; slug?: string; what?: string } | null;
  state?: string;
  createdAt?: number;
  costTokens?: number;
  project?: string | null;
  lastError?: string | null;
  tier?: string | null;
};

/** /api/yard/job/:id — the job again, plus the tail of its log. Optional throughout: an
 *  unreachable server must degrade to the summary we already have, never to nothing. */
export type TaskDetail = {
  job?: (RecentTask & { steps?: { label: string; state: string; error?: string }[]; startedAt?: number | null; finishedAt?: number | null }) | null;
  log?: string[] | null;
};

/** One picked task, resolved. `label` is what sits in the message box; `context` is what the
 *  model gets and the operator never has to read. */
export type TaskReference = { id: string; label: string; context: string };

// A query longer than this is prose, not a search — somebody wrote an email address with a
// space in front of it, or is quoting something. Stop offering.
const MAX_QUERY = 32;

/** How much of a referenced task travels with the message. The server clips a HISTORY turn to
 *  1200 chars, so a reference is sized to the same order — big enough for the failure and the
 *  last few log lines, small enough that three references don't eat a free-tier budget. */
export const MAX_CONTEXT = 1200;

export type Mention = { start: number; query: string };

/**
 * Is the caret sitting inside a live `@`? Returns where it starts and what has been typed
 * since, or null.
 *
 * The two rules that matter are both about NOT firing. `@` only opens a mention at the start
 * of the box or after whitespace, which is what keeps `romeo@example.com` and `npm i foo@2`
 * from popping a task list over the keyboard mid-address — the single most annoying way this
 * feature can be built. And any whitespace after the `@` closes it again, which is what lets
 * an inserted label ("@Build: mainline ") end its own mention without a flag to unset.
 */
export function findMention(text: string, cursor: number = text.length): Mention | null {
  const head = text.slice(0, Math.max(0, Math.min(cursor, text.length)));
  const start = head.lastIndexOf('@');
  if (start < 0) return null;
  const before = start > 0 ? head[start - 1] : '';
  if (before && !/\s/.test(before)) return null;   // mid-word, or an email address
  const query = head.slice(start + 1);
  if (/\s/.test(query)) return null;               // the mention already ended
  if (query.length > MAX_QUERY) return null;
  return { start, query };
}

/** Replace the half-typed `@que` with the real label, cursor after it. The trailing space is
 *  load-bearing, not cosmetic: it is what makes findMention() return null on the very next
 *  keystroke, so picking one task closes the picker instead of re-opening it on its own name. */
export function applyMention(
  text: string,
  mention: Mention,
  label: string,
  cursor: number = mention.start + 1 + mention.query.length,
): { text: string; cursor: number } {
  const tail = text.slice(Math.max(mention.start, Math.min(cursor, text.length)));
  // Borrow the space that is already there rather than adding a second one — inserting into
  // the middle of a sentence should not leave a gap the operator has to go back and delete.
  const pad = /^\s/.test(tail) ? '' : ' ';
  const token = `@${label}${pad}`;
  return { text: text.slice(0, mention.start) + token + tail, cursor: mention.start + token.length + (pad ? 0 : 1) };
}

/** Take a reference back out — the chip's ✕. Removes the first occurrence only, so two
 *  references to the same task (which the picker allows) don't both vanish on one tap. */
export function removeMention(text: string, label: string): string {
  const token = `@${label}`;
  const at = text.indexOf(token);
  if (at < 0) return text;
  const after = at + token.length;
  const eatSpace = text[after] === ' ' ? 1 : 0;
  return (text.slice(0, at) + text.slice(after + eatSpace)).replace(/[ \t]+$/, '');
}

/** Same naming the desk and the Tasks surface use (src/TasksView.tsx titleFor) — a job must
 *  not be called one thing in a list and another in a reference. */
export function taskTitle(t: Pick<RecentTask, 'id' | 'kind' | 'payload' | 'project'>): string {
  const p = t.payload || {};
  switch (t.kind) {
    case 'project.build':
      return `Build: ${p.name || t.project || t.id}`;
    case 'project.create':
      return `Create: ${p.name || t.id}`;
    case 'project.edit':
      return `Edit ${p.slug || t.project || 'project'}`;
    case 'project.deploy':
      return `Deploy ${p.slug || t.project || t.id}`;
    default:
      return t.project ? `${t.kind} · ${t.project}` : t.kind;
  }
}

/**
 * A glyph for what KIND of work a job is — build, deploy, edit — so a list of them can be
 * scanned rather than read. State is not encoded here: it already has a colour and a word of
 * its own, and a row that says "failed" twice in two alphabets is not clearer for it.
 *
 * Monochrome on purpose. These sit in a neutral square and are drawn in SAM's terracotta, which
 * is the one brand colour the chrome is allowed (lib/ios.ts) — a Settings-style row of red,
 * blue and green squares would import another product's palette wholesale.
 *
 * U+FE0E is the text-presentation selector. Without it iOS renders several of these as colour
 * emoji, which is exactly the thing above. Kinds come from the desk's titleFor
 * (src/TasksView.tsx) so the two surfaces agree about what a job is.
 */
export function taskGlyph(kind: string | null | undefined): string {
  switch (kind) {
    case 'project.build':
      return '⚒︎'; // hammer and pick
    case 'project.create':
      return '✚︎'; // heavy greek cross
    case 'project.edit':
      return '✎︎'; // lower-left pencil
    case 'project.deploy':
      return '↑'; // upwards arrow — ship it
    case 'project.checkpoint':
      return '⚑︎'; // black flag
    case 'project.restore':
      return '↺'; // anticlockwise open circle arrow
    default:
      // Group by family before giving up, so a kind nobody has taught this function still gets
      // something better than a bullet if its prefix is one we know.
      if (kind?.startsWith('notebook.')) return '≡'; // identical to — stacked lines
      if (kind?.startsWith('standing.')) return '◉'; // fisheye — a standing eye on something
      return '▸'; // small right-pointing triangle
  }
}

/**
 * How long ago a job ran, for surfaces about recency rather than record. `toLocaleString()` is
 * right in the Tasks list — that is a log, and "which run was it" needs a date. On a "pick up
 * where you left off" card the question is only "how stale is this", and `8/8/2026, 9:51:42 PM`
 * answers it with a mental subtraction plus six characters of second-precision nobody wanted.
 *
 * Rounds DOWN throughout, so a card never claims a job is older than it is. `now` is a parameter
 * because a clock read inside a formatter cannot be tested.
 */
export function taskWhen(createdAt: number | null | undefined, now: number = Date.now()): string {
  if (!createdAt || !Number.isFinite(createdAt)) return '';
  const secs = Math.floor((now - createdAt) / 1000);
  // A clock skewed a little between the phone and the Mac must not read "in 4 minutes".
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(createdAt).toLocaleDateString();
}

/** The title, made safe to live inside a message: no newlines (they would split the token
 *  across lines) and no second `@` (it would start a new mention inside this one). */
export function mentionLabel(t: RecentTask): string {
  return taskTitle(t).replace(/[\r\n]+/g, ' ').replace(/@/g, '').replace(/\s+/g, ' ').trim() || t.id;
}

/** Newest first, filtered by what has been typed so far. Case- and word-position-insensitive:
 *  "@main" should find "Build: mainline" — nobody remembers what a job's title starts with. */
export function matchTasks(tasks: RecentTask[], query: string, limit = 6): RecentTask[] {
  const q = query.trim().toLowerCase();
  const ranked = [...tasks].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const hits = q ? ranked.filter((t) => `${mentionLabel(t)} ${t.kind} ${t.project ?? ''}`.toLowerCase().includes(q)) : ranked;
  return hits.slice(0, limit);
}

function when(ms?: number | null): string {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : 'unknown time';
}

/**
 * What SAM actually receives for one reference: the facts of the job, then as much of its log
 * tail as the budget allows. Written as prose the model reads rather than JSON it has to
 * decode — the same choice formatHistory() makes server-side.
 *
 * `detail` is optional on purpose. If /api/yard/job/:id could not be reached, the summary row
 * we already have still names the job, its state and its error, which is enough to ask a
 * question about. A reference that silently became nothing would be worse than a short one.
 */
export function taskContext(task: RecentTask, detail?: TaskDetail | null, maxChars = MAX_CONTEXT): string {
  const job = detail?.job ?? task;
  const head = [
    `Task "${taskTitle(task)}" (${task.id})`,
    `state: ${job.state ?? 'unknown'}`,
    `started: ${when(job.createdAt ?? task.createdAt)}`,
    job.project ? `project: ${job.project}` : '',
    job.costTokens ? `cost: ${job.costTokens} tokens` : '',
    job.tier ? `brain: ${job.tier}` : '',
  ].filter(Boolean).join(' · ');

  const lines: string[] = [head];
  const steps = detail?.job?.steps;
  if (steps?.length) {
    lines.push(`Steps: ${steps.map((s) => `${s.label} (${s.state}${s.error ? `: ${s.error}` : ''})`).join(', ')}`);
  }
  if (job.lastError) lines.push(`Error: ${job.lastError}`);

  // The log is the part that gets long, so it is the part that gets cut — and it is cut from
  // the FRONT, because the end of a log is where the failure is.
  const log = (detail?.log ?? []).filter((l) => typeof l === 'string' && l.trim());
  if (log.length) {
    const budget = maxChars - lines.join('\n').length - 20;
    const kept: string[] = [];
    let used = 0;
    for (let i = log.length - 1; i >= 0; i--) {
      used += log[i].length + 1;
      if (used > budget) break;
      kept.unshift(log[i].trim());
    }
    if (kept.length) lines.push(`Log (last ${kept.length} lines):`, ...kept);
  }
  return lines.join('\n').slice(0, maxChars);
}

/** Drop references whose token the operator has since deleted from the box. Kept as a filter
 *  at send time rather than as bookkeeping on every keystroke: backspacing over "@Build:
 *  mainline" must actually un-reference it, and there is no edit event that reliably says so. */
export function activeReferences(draft: string, refs: TaskReference[]): TaskReference[] {
  return refs.filter((r) => draft.includes(`@${r.label}`));
}

/**
 * The message as it goes over the wire. The operator's own words are LAST and unchanged —
 * the context is a preamble, the way formatHistory() puts the conversation before the new
 * message server-side, so the model never confuses what was fetched with what was asked.
 *
 * The bubble on screen keeps showing the typed text alone. A user who types "@Build: mainline
 * why did it fail" should see that, not eight lines of build log they didn't write.
 */
export function buildReferencedMessage(message: string, refs: TaskReference[]): string {
  if (!refs.length) return message;
  const blocks = refs.map((r) => r.context.trim()).filter(Boolean);
  if (!blocks.length) return message;
  return [
    `Referenced ${blocks.length === 1 ? 'task' : 'tasks'} (context — the user's message comes after this):`,
    blocks.join('\n---\n'),
    '',
    message,
  ].join('\n');
}
