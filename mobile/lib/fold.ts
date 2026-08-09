// THE FOLD — what a job DID, in one line you can scan.
//
// The Tasks list used to print `createdAt.toLocaleString() · costTokens tokens`. That is a
// receipt, not a story: it tells you a job happened and when, and nothing whatsoever about what
// it was. Meanwhile the yard has been recording a real step list on every job all along
// (server/yard/store.ts JobStep) and the phone was throwing it away.
//
// Ported from the mechanism in Manus's session view, which is the best idea in that product.
// Its `summarizeToolGroup` collapses a finished turn into a past-tense phrase, and it works
// because of three specific rules — not because it summarises:
//
//   1. DE-DUPLICATE BY IDENTITY, NOT BY CALL. Forty reads of three files is "Read 3 files".
//      The identity here is the step's target (a path, a name), not the step itself.
//   2. COUNTS SATURATE. Above ten the number stops carrying information and is dropped
//      entirely — "Read the repo", never "Read 47 files". A big number reads as noise.
//   3. AT MOST THREE PHRASES, middot-separated. A fold that lists everything is the thing it
//      was supposed to replace.
//
// And the rule that makes it safe: THE FOLD NEVER EATS THE ANSWER. Folding is for finished
// work. A live job renders its current step plainly, because that is the thing you opened the
// app to see. Process is disposable; what happened is not.

export type JobStep = {
  label: string;
  state: 'running' | 'done' | 'failed' | 'stopped';
  at?: number;
  error?: string;
};

/** Above this a count stops being information. Manus's own threshold, and it is the rule that
 *  keeps the line readable — "Browsed 47 pages" is worse than "Browsed the web". */
const SATURATE = 10;
/** Three phrases. A fourth is a list, and a list is what this replaces. */
const MAX_PHRASES = 3;

type Category = {
  key: string;
  match: RegExp;
  /** past tense, for a finished job: (n, saturated) => phrase */
  done: (n: number, many: boolean) => string;
};

// Ordered: the first match wins, so the more specific verbs come first. These are matched
// against the step LABELS the job itself declared — never a model's after-the-fact guess.
const CATEGORIES: Category[] = [
  { key: 'deploy', match: /\b(deploy|publish|ship|upload|release)/i, done: () => 'Deployed' },
  { key: 'install', match: /\b(install|npm|yarn|pnpm|pod)\b/i, done: () => 'Installed dependencies' },
  { key: 'build', match: /\b(build|compil|bundl|pack)/i, done: () => 'Built the project' },
  { key: 'test', match: /\b(test|spec|lint|typecheck|check)/i, done: () => 'Ran checks' },
  { key: 'write', match: /\b(writ|edit|updat|creat|add|renam|delet|remov)/i, done: (n, many) => (many ? 'Edited the project' : `Edited ${n} file${n === 1 ? '' : 's'}`) },
  { key: 'read', match: /\b(read|open|load|inspect|look)/i, done: (n, many) => (many ? 'Read the project' : `Read ${n} file${n === 1 ? '' : 's'}`) },
  { key: 'browse', match: /\b(browse|fetch|search|crawl|http)/i, done: (n, many) => (many ? 'Browsed the web' : `Browsed ${n} page${n === 1 ? '' : 's'}`) },
  { key: 'run', match: /\b(run|exec|command|shell|script)/i, done: () => 'Ran commands' },
];

/**
 * The identity a step de-duplicates on. A path or a quoted name if the label carries one,
 * otherwise the label itself with its leading verb stripped — so "Reading src/App.tsx" and
 * "Read src/App.tsx" are one thing, and forty of them are still one thing.
 */
export function stepIdentity(label: string): string {
  const path = label.match(/([\w./-]+\.[a-z0-9]{1,6})\b/i);
  if (path) return path[1].toLowerCase();
  const quoted = label.match(/["'`]([^"'`]+)["'`]/);
  if (quoted) return quoted[1].toLowerCase();
  return label
    .toLowerCase()
    .replace(/^(re-?)?(reading|read|writing|write|running|run|building|build|opening|open|editing|edit|installing|install|checking|check|deploying|deploy)\b\s*/i, '')
    .replace(/[.…]+$/, '')
    .trim() || label.toLowerCase();
}

function categorise(label: string): Category | null {
  return CATEGORIES.find((c) => c.match.test(label)) ?? null;
}

/**
 * A finished job's steps, folded to at most three past-tense phrases.
 *
 * Returns '' when there is nothing honest to say — no steps at all, which is the common case
 * for a job the yard finished before it learned to record any. An empty string is a caller's
 * cue to fall back to what it already had, NOT a reason to invent a summary.
 */
export function foldSteps(steps: JobStep[] | undefined | null): string {
  if (!steps?.length) return '';

  // Bucket by category, collecting DISTINCT identities per bucket (rule 1).
  const buckets = new Map<string, { cat: Category | null; ids: Set<string>; first: string }>();
  for (const step of steps) {
    if (!step?.label) continue;
    const cat = categorise(step.label);
    const key = cat ? cat.key : `~${step.label.toLowerCase()}`;
    const bucket = buckets.get(key) ?? { cat, ids: new Set<string>(), first: step.label };
    bucket.ids.add(stepIdentity(step.label));
    buckets.set(key, bucket);
  }

  const phrases: string[] = [];
  for (const { cat, ids, first } of buckets.values()) {
    if (phrases.length >= MAX_PHRASES) break; // rule 3
    const n = ids.size;
    // rule 2 — past the threshold the count is dropped, not printed
    phrases.push(cat ? cat.done(n, n > SATURATE) : first);
  }
  return phrases.join(' · ');
}

/**
 * TENSE IS THE STATE MACHINE.
 *
 * Live copy is present continuous and names the ACT — "Building the project" — because while
 * a job runs the only question is what it is doing right now. Finished copy is past tense and
 * names the RESULT. Blocked gets its own word, because "waiting for you" is neither running
 * nor failed and rendering it as either is a lie about who the ball is with.
 *
 * Returns '' rather than a placeholder when there is nothing to say, so the caller keeps
 * whatever it was showing instead of replacing real information with "Working…".
 */
export function runLine(job: {
  state?: string | null;
  steps?: JobStep[] | null;
  lastError?: string | null;
}): string {
  const steps = job.steps ?? [];

  if (job.state === 'running') {
    // The step the job itself says is in flight. Not the last step in the array — a failed
    // step followed by a running one would otherwise report the failure as current.
    const live = [...steps].reverse().find((s) => s.state === 'running');
    if (live) return toPresent(live.label);
    return steps.length ? `Step ${steps.length}` : '';
  }

  if (job.state === 'failed') {
    const broke = [...steps].reverse().find((s) => s.state === 'failed');
    // The step's own error beats the job's, being closer to what actually went wrong.
    if (broke) return broke.error ? `${broke.label} — ${broke.error}` : `Failed at ${lower(broke.label)}`;
    return job.lastError || '';
  }

  if (job.state === 'queued') return 'Waiting to start';
  if (job.state === 'cancelled' || job.state === 'stopped') return 'Stopped';

  return foldSteps(steps);
}

/** "Building" from "Build the project" — the label as the act currently in progress. */
function toPresent(label: string): string {
  const trimmed = label.trim().replace(/[.…]+$/, '');
  const m = trimmed.match(/^([a-z]+)(\b.*)$/i);
  if (!m) return trimmed;
  const [, verb, rest] = m;
  if (/(ing)$/i.test(verb)) return trimmed; // already present continuous
  const stem = /e$/i.test(verb) && !/ee$/i.test(verb) ? verb.slice(0, -1) : verb;
  return `${stem.charAt(0).toUpperCase()}${stem.slice(1)}ing${rest}…`;
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * How long a job has been running, or how long it took.
 *
 * `now` is a parameter because a clock read inside a formatter cannot be tested — the same
 * convention taskWhen() in mentions.ts already uses. Callers must only tick this while a job
 * is actually running: an interval that keeps firing after a job finishes is a battery cost
 * for a number that can no longer change.
 */
export function elapsed(
  job: { startedAt?: number | null; finishedAt?: number | null; createdAt?: number | null },
  now: number = Date.now(),
): string {
  const from = job.startedAt ?? job.createdAt;
  // `== null`, not `!from`: 0 is a real timestamp and a falsy check silently drops it. Nothing
  // in production starts at the epoch, but a guard that is wrong for a reason is a guard that
  // will be wrong again somewhere it matters.
  if (from == null || !Number.isFinite(from)) return '';
  const to = job.finishedAt ?? now;
  const secs = Math.floor((to - from) / 1000);
  if (secs < 0) return ''; // a phone and a Mac disagreeing about the clock must not read "-3s"
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
