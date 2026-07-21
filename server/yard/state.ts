// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — job states (pure rules)
//
//  The yard runs long work — builds that take minutes — without the assistant
//  going quiet. Everything about WHEN a job may change state lives here, with no
//  database and no processes, so the rules can be proven directly rather than
//  inferred from behaviour.
//
//  The rule that matters most: a job whose worker died must not sit as `running`
//  for ever. Nothing would ever move it, and a queue with a permanent phantom in
//  it looks identical to a queue that is simply busy. So `running` is a claim that
//  has to be renewed — a heartbeat — and a claim that stops being renewed is
//  forfeit. This is the same reasoning as the money desk's watchdog: silence is
//  not evidence that something is fine.
// ─────────────────────────────────────────────────────────────

export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

// Why a job failed. Only `transient` is ever worth trying again: a budget stop is a
// deliberate limit and an operator cancel is a deliberate decision — retrying either
// would be the machine overruling the person.
export type FailureKind = "transient" | "permanent" | "budget" | "abandoned";

export const TERMINAL: JobState[] = ["done", "failed", "cancelled"];
export const isTerminal = (s: JobState) => TERMINAL.includes(s);

// A worker renews its claim on this cadence; three missed renewals and the claim is
// treated as forfeit. Generous on purpose — a busy machine must not lose a live job.
export const HEARTBEAT_MS = 10_000;
export const HEARTBEAT_GRACE_MS = 30_000;

export const MAX_ATTEMPTS = 3;

const ALLOWED: Record<JobState, JobState[]> = {
  queued: ["running", "cancelled"],
  running: ["done", "failed", "cancelled"],
  done: [],
  failed: ["queued"],      // only via retry, and only for a transient failure
  cancelled: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

// Throwing rather than returning false: an illegal transition is a programming error,
// and a silently-ignored state change is precisely the class of bug that makes a queue
// impossible to reason about later.
export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) throw new Error(`the yard: a job cannot go from ${from} to ${to}`);
}

// A claim is forfeit once it has gone unrenewed past the grace period. A job that has
// never heartbeated is judged from when it started, so a worker that died on its very
// first step is still recovered.
export function isClaimForfeit(job: { state: JobState; heartbeatAt: number | null; startedAt: number | null }, now: number): boolean {
  if (job.state !== "running") return false;
  const last = job.heartbeatAt ?? job.startedAt;
  if (last === null) return true;   // running with no clock at all — nothing can renew it
  return now - last > HEARTBEAT_GRACE_MS;
}

export function isRetryable(kind: FailureKind, attempts: number): boolean {
  if (kind !== "transient" && kind !== "abandoned") return false;
  return attempts < MAX_ATTEMPTS;
}

// Capped exponential backoff. Capped because an unbounded one eventually schedules a
// retry past the point anybody is still watching, which reads as the job vanishing.
export function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(0, attempts - 1) * 1000, 30_000);
}

// The meter. A job carries its own ceiling so one runaway build cannot spend the
// allowance of every job behind it.
export function overBudget(spent: number, budget: number | null): boolean {
  if (budget === null || budget <= 0) return false;   // no ceiling set ⇒ nothing to cross
  return spent >= budget;
}
