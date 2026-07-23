// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE SCRUB — one place that decides what a log may say
//
//  SAM writes to several sinks: the server's own console, per-job logs in the yard,
//  the Black Box, the Trail. A secret only has to reach ONE of them to be on disk in
//  plain text for ever, so the decision belongs in one place rather than at each
//  call site where it can be forgotten.
//
//  Two halves, deliberately:
//
//   1. BY SHAPE — anything that looks like a credential is redacted whether or not
//      SAM has ever seen it. This catches a key the user pasted into chat, a token in
//      an error message from a library, a secret from a provider added after this
//      code was written.
//
//   2. BY REFERENCE — the actual values of environment variables whose NAME ends in
//      _TOKEN, _KEY, _SECRET, _PASSWORD. The scrubber looks these up at call time and
//      never stores them, so this file holds no secret of its own and there is no
//      configuration to leak. It catches the case shape-matching cannot: a credential
//      with no recognisable format.
// ─────────────────────────────────────────────────────────────

export const REDACTED = "[redacted]";

// Names whose VALUES must never be printed. Matched on the name, so a new provider is
// covered the day it is added without touching this file.
const SENSITIVE_NAME = /(^|_)(TOKEN|KEY|KEYS|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL|COOKIE|SESSION)$/i;

export function sensitiveEnvNames(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.keys(env).filter((k) => SENSITIVE_NAME.test(k));
}

// The shapes. Ordered longest-prefix-first so a more specific provider wins.
const SHAPES: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  /\bsk-or-[A-Za-z0-9_-]{16,}/g,
  /\bsk-proj-[A-Za-z0-9_-]{16,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgsk_[A-Za-z0-9]{20,}/g,
  /\bvcp_[A-Za-z0-9]{20,}/g,
  /\bcsk-[A-Za-z0-9]{20,}/g,
  /\bnvapi-[A-Za-z0-9_-]{20,}/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /\b[A-Fa-f0-9]{40,}\b/g,                       // long hex: session ids, sha-style secrets
];

// Redact a string. Values first (a known secret is redacted even if it looks like
// nothing), then shapes.
export function scrub(text: unknown, env: NodeJS.ProcessEnv = process.env): string {
  let s = typeof text === "string" ? text : String(text ?? "");
  if (!s) return s;

  // BY REFERENCE. Short values are skipped: a two-character "key" would turn every
  // occurrence of those characters in a log line into noise.
  for (const name of sensitiveEnvNames(env)) {
    const v = env[name];
    if (!v || v.length < 8) continue;
    // A comma-list (the pooled *_KEYS form) is several secrets in one variable.
    for (const part of v.split(",")) {
      const p = part.trim();
      if (p.length < 8) continue;
      s = s.split(p).join(`${p.slice(0, 3)}${REDACTED}`);
    }
  }

  // BY SHAPE, with the prefix kept so a log still says WHICH kind of thing was there —
  // "vcp_[redacted]" is diagnosable; a bare "[redacted]" is not.
  for (const re of SHAPES) {
    s = s.replace(re, (m) => {
      const keep = /^Bearer/i.test(m) ? "Bearer " : m.slice(0, Math.min(4, m.length));
      return `${keep}${REDACTED}`;
    });
  }
  return s;
}

// Redact anything, following objects and arrays. Used where a log takes structured data.
export function scrubDeep(value: unknown, env: NodeJS.ProcessEnv = process.env, depth = 0): unknown {
  if (depth > 6) return "[too deep]";
  if (value == null) return value;
  if (typeof value === "string") return scrub(value, env);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, env, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // A sensitive NAME redacts wholesale — the value's shape is irrelevant if the key
      // already tells you what it is.
      out[k] = SENSITIVE_NAME.test(k) || /token|secret|password|passphrase|apikey/i.test(k)
        ? REDACTED
        : scrubDeep(v, env, depth + 1);
    }
    return out;
  }
  return String(value);
}

// AUDIT FIX: console.log(obj) used to bypass the scrub entirely — only string args were
// redacted, so a secret carried inside an OBJECT (the common `console.log("ctx", { key })`
// shape) reached server.log in the clear. scrubDeep walks objects/arrays (name- AND
// shape-based redaction, depth-capped so a cycle can't loop). An Error is rendered to its
// scrubbed stack so error logging keeps its detail; primitives have nothing to redact.
function scrubArg(a: any): any {
  if (typeof a === "string") return scrub(a);
  if (a instanceof Error) return scrub(a.stack || `${a.name}: ${a.message}`);
  return scrubDeep(a);
}

// Wrap the process's own console so anything SAM prints goes through the scrub. Applied
// once at startup; returns a function that puts the original back (for tests).
export function scrubConsole(target: Console = console): () => void {
  const original = { log: target.log, warn: target.warn, error: target.error, info: target.info };
  const wrap = (fn: (...a: any[]) => void) => (...args: any[]) => fn(...args.map(scrubArg));
  target.log = wrap(original.log);
  target.warn = wrap(original.warn);
  target.error = wrap(original.error);
  target.info = wrap(original.info);
  return () => { target.log = original.log; target.warn = original.warn; target.error = original.error; target.info = original.info; };
}

// ── Paths in messages people see ────────────────────────────────────────────
// A raw error message routinely carries an absolute path — "ENOENT: no such file or
// directory, open '/Users/alex/sam/vault/keys.json'". That names the operator, their
// layout, and often what SAM keeps where. Homes collapse to ~, so the message stays
// diagnosable without describing the machine.
export function collapseHomes(text: string): string {
  return String(text ?? "")
    .replace(/\/Users\/[^/\s"')]+/g, "~")
    .replace(/\/home\/[^/\s"')]+/g, "~")
    .replace(/C:\\Users\\[^\\\s"')]+/gi, "~");
}

// What an error may say to a caller. Secrets removed, machine layout removed, length
// bounded so a stack-shaped blob cannot arrive by another route. Development keeps the
// full text, because that is where the detail is worth having.
export function publicError(e: unknown, dev = process.env.NODE_ENV === "development"): string {
  const raw = String((e as any)?.message ?? e ?? "").trim();
  const cleaned = collapseHomes(scrub(raw));
  if (dev) return cleaned;
  return cleaned.split("\n")[0].slice(0, 300);
}
