// ─────────────────────────────────────────────────────────────
//  S.A.M. · OUTCOME  — failures are RETURNED, not thrown or swallowed.
//
//  SAM's #1 recurring bug class is the silent failure: a swallowed catch, an operation that
//  "succeeds" doing nothing. On the failure-prone core, a function returns an Outcome<T, E> — either
//  a value or a typed error — so the caller must look at which one it got before reaching the value.
//  The error is part of the type: a new failure mode is a new `E` variant the caller must handle.
//
//  Honest limit: TypeScript has no `#[must_use]` for a synchronous return — the compiler can't fail a
//  build that ignores an Outcome the way Rust does. What IS enforced: strictNullChecks (on), and for
//  async work no-floating-promises. Beyond that, keeping T reachable only via `match`/`unwrap` makes
//  ignoring the error visible in review. Outcome is about ERROR HANDLING, not concurrency — aliasing
//  and cross-process races stay the Latch's runtime job.
// ─────────────────────────────────────────────────────────────

export type Outcome<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Outcome<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Outcome<never, E> => ({ ok: false, error });

export function isOk<T, E>(o: Outcome<T, E>): o is { ok: true; value: T } { return o.ok; }
export function isErr<T, E>(o: Outcome<T, E>): o is { ok: false; error: E } { return !o.ok; }

/** Exhaustive fork — both arms required, so adding neither is a type error. Returns one R. */
export function match<T, E, R>(o: Outcome<T, E>, on: { ok: (value: T) => R; err: (error: E) => R }): R {
  return o.ok ? on.ok(o.value) : on.err(o.error);
}

/** The value, or a fallback for the error case. For callers that only care about success. */
export function unwrapOr<T, E>(o: Outcome<T, E>, fallback: T): T { return o.ok ? o.value : fallback; }

/**
 * Exhaustiveness guard for discriminated-union state machines. Put it in a switch's `default:` — if a
 * new variant is added and left unhandled, `x` is no longer `never` and this fails to COMPILE. At
 * runtime (should a value slip past the types) it throws loudly rather than silently proceeding.
 */
export function assertNever(x: never, context = "value"): never {
  throw new Error(`unreachable ${context}: ${JSON.stringify(x)}`);
}
