// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the confined executor
//
//  The only place in SAM where a job may run a command. Everything here is written
//  on the assumption that the thing asking is not trustworthy: a job's payload is
//  shaped by a model, and a model will eventually ask for something ruinous without
//  meaning to.
//
//  Four rules, each enforced independently so no single mistake opens the door:
//
//   1. NO SHELL. Commands are argv arrays handed to execFile. There is no string for
//      a quote, a semicolon or a backtick to escape out of, so command injection has
//      nowhere to happen rather than being filtered.
//   2. CONFINEMENT BY RESOLUTION. Every directory and every path-shaped argument is
//      resolved to what it REALLY is — symlinks followed — and then tested against the
//      job's project directory. Comparing the strings people typed is the classic way
//      to be fooled; `..`, a symlink, or a home-relative path all look innocent until
//      resolved.
//   3. A DENY LIST APPLIED AFTER RESOLUTION, so it cannot be side-stepped by spelling.
//      The money rig is on it by absolute path: nothing the yard runs may read, write
//      or even reach into it while it is mid-experiment.
//   4. A SCRUBBED ENVIRONMENT. The child gets a short whitelist and a HOME pointing at
//      its own project. It never sees the parent's environment, so it never sees a key.
//
//  And the gate in front of all of it: the Handshake must be enforced. Position on the
//  loopback interface is not authorization, and running commands is the point at which
//  that stops being a philosophical distinction.
// ─────────────────────────────────────────────────────────────

import { execFile } from "node:child_process";
import { realpathSync, existsSync } from "node:fs";
import { resolve, sep, dirname, isAbsolute, join } from "node:path";
import os from "node:os";
import { handshakeEnforced } from "../handshake.ts";

// Only what a build genuinely needs. Adding to this list is a security decision, not a
// convenience one — every entry is something a job may cause to happen on the machine.
export const ALLOWED_COMMANDS = ["npm", "npx", "node", "git", "vercel", "railway", "wrangler", "supabase"] as const;

// Never reachable, whatever a payload says and however it is spelled. Checked after
// resolution, so a symlink or a `..` walk lands here too.
export function denyList(): string[] {
  const home = os.homedir();
  return [
    join(home, "flip-it"),        // the money rig, mid-experiment — radioactive
    join(home, "sam"),            // SAM's own source
    join(home, "sam-signing"),    // code-signing material
    join(home, "sam-backups"),
    join(home, ".ssh"),
    join(home, ".aws"),
    join(home, ".gnupg"),
    join(home, "Library"),
    join(home, ".config"),
  ];
}

export type ExecRefusal =
  | { ok: false; reason: string; rule: "handshake" | "command" | "confinement" | "deny" | "shape" };
export type ExecPlan = { ok: true; command: string; args: string[]; cwd: string };

// Resolve a path to what it REALLY is. A path that does not exist yet (a file a build is
// about to write) is resolved via its nearest existing ancestor, so the check still sees
// through a symlinked parent instead of giving up and trusting the string.
export function trueLocation(p: string): string {
  let candidate = resolve(p);
  const unresolved: string[] = [];
  // Walk up until something exists; realpath that, then re-attach what we walked past.
  for (let i = 0; i < 64; i++) {
    if (existsSync(candidate)) {
      try { return resolve(realpathSync(candidate), ...unresolved); } catch { return candidate; }
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;   // reached the root
    unresolved.unshift(candidate.slice(parent.length + 1));
    candidate = parent;
  }
  return resolve(p);
}

// Is `target` genuinely inside `root`? Compared after both are resolved, and with a
// separator so that a sibling named like the root ("/x/project-evil" vs "/x/project")
// cannot pass on a prefix match.
export function isWithin(root: string, target: string): boolean {
  const r = trueLocation(root);
  const t = trueLocation(target);
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}

export function hitsDenyList(target: string): string | null {
  const t = trueLocation(target);
  for (const denied of denyList()) {
    const d = trueLocation(denied);
    if (t === d || t.startsWith(d.endsWith(sep) ? d : d + sep)) return denied;
  }
  return null;
}

// An argument is treated as a path if it looks like one at all. False positives are
// harmless here — a flag that happens to contain a slash simply gets checked — whereas
// a false negative is a hole.
export function looksLikePath(arg: string): boolean {
  if (!arg || arg.startsWith("-")) return false;
  return isAbsolute(arg) || arg.startsWith("~") || arg.includes("/") || arg.includes("\\") || arg === "..";
}

// The whole decision, as a pure function: given a project root and a request, either a
// plan that is safe to run or a refusal that says which rule stopped it.
export function planExec(
  projectRoot: string,
  command: string,
  args: string[],
  opts: { cwd?: string; handshake?: boolean } = {},
): ExecPlan | ExecRefusal {
  const handshake = opts.handshake ?? handshakeEnforced();
  if (!handshake) {
    return { ok: false, rule: "handshake", reason: "the yard will not run commands unless the Handshake is enforced — being on this machine is not the same as being authorised (set SAM_REQUIRE_CONTROL_TOKEN=1)" };
  }
  if (typeof command !== "string" || !command) {
    return { ok: false, rule: "shape", reason: "no command given" };
  }
  if (!(ALLOWED_COMMANDS as readonly string[]).includes(command)) {
    return { ok: false, rule: "command", reason: `"${command}" is not one of the commands the yard may run (${ALLOWED_COMMANDS.join(", ")})` };
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    return { ok: false, rule: "shape", reason: "arguments must be a list of strings — the yard never builds a shell string" };
  }
  // Belt and braces: with execFile there is no shell to interpret these, but a payload
  // carrying them is a signal worth refusing on rather than quietly running.
  const sneaky = args.find((a) => /[;&|`$\n\r]|\$\(/.test(a));
  if (sneaky !== undefined) {
    return { ok: false, rule: "shape", reason: `refused an argument carrying shell punctuation: ${sneaky.slice(0, 60)}` };
  }

  const root = trueLocation(projectRoot);
  const cwd = trueLocation(opts.cwd ? (isAbsolute(opts.cwd) ? opts.cwd : join(projectRoot, opts.cwd)) : projectRoot);

  const deniedRoot = hitsDenyList(root);
  if (deniedRoot) return { ok: false, rule: "deny", reason: `the yard will never work inside ${deniedRoot}` };
  if (!isWithin(root, cwd)) {
    return { ok: false, rule: "confinement", reason: `the working directory resolves to ${cwd}, which is outside the project (${root})` };
  }
  const deniedCwd = hitsDenyList(cwd);
  if (deniedCwd) return { ok: false, rule: "deny", reason: `the yard will never work inside ${deniedCwd}` };

  for (const arg of args) {
    if (!looksLikePath(arg)) continue;
    const expanded = arg.startsWith("~") ? join(os.homedir(), arg.slice(1)) : (isAbsolute(arg) ? arg : join(cwd, arg));
    const denied = hitsDenyList(expanded);
    if (denied) return { ok: false, rule: "deny", reason: `refused "${arg}" — it reaches into ${denied}` };
    if (!isWithin(root, expanded)) {
      return { ok: false, rule: "confinement", reason: `refused "${arg}" — it resolves to ${trueLocation(expanded)}, outside the project` };
    }
  }

  return { ok: true, command, args, cwd };
}

// The child's whole world. HOME points at the project so a tool that writes a config
// writes it there; nothing from the parent environment is carried across, which is what
// keeps every key in the vault invisible to anything a job runs.
export function childEnv(projectRoot: string, injected: Record<string, string> = {}): Record<string, string> {
  const safe: Record<string, string> = {
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: projectRoot,
    TMPDIR: process.env.TMPDIR || "/tmp",
    LANG: process.env.LANG || "en_GB.UTF-8",
    NODE_ENV: "development",
    CI: "1",                       // keeps build tools non-interactive
    npm_config_fund: "false",
    npm_config_audit: "false",
    npm_config_update_notifier: "false",
  };
  // Injected values are per-job and explicit. Names are constrained so a payload cannot
  // smuggle in something like LD_PRELOAD or NODE_OPTIONS.
  for (const [k, v] of Object.entries(injected)) {
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(k)) continue;
    if (["PATH", "HOME", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS"].includes(k)) continue;
    safe[k] = String(v);
  }
  return safe;
}

export interface ExecResult { code: number; stdout: string; stderr: string; truncated: boolean }

const OUTPUT_CAP = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

// Run a planned command. Never takes a shell, never inherits the environment, and always
// resolves — a non-zero exit is a result the job can reason about, not an exception.
export function runPlanned(
  plan: ExecPlan,
  projectRoot: string,
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<ExecResult> {
  return new Promise((res) => {
    execFile(plan.command, plan.args, {
      cwd: plan.cwd,
      env: childEnv(projectRoot, opts.env ?? {}),
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: OUTPUT_CAP,
      shell: false,                 // stated explicitly: this must never become true
      windowsHide: true,
    }, (err: any, stdout, stderr) => {
      const truncated = !!err && /maxBuffer/i.test(String(err?.message || ""));
      res({
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        stdout: String(stdout || "").slice(0, OUTPUT_CAP),
        stderr: String(stderr || err?.message || "").slice(0, OUTPUT_CAP),
        truncated,
      });
    });
  });
}

// What a job handler calls. Refusals are thrown so they cannot be mistaken for output —
// the mistake that made SAM claim it had no access to its own repositories.
export class ExecRefused extends Error {
  constructor(readonly rule: string, message: string) { super(`the yard refused this: ${message}`); }
}

export async function execInProject(
  projectRoot: string,
  command: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number; handshake?: boolean } = {},
): Promise<ExecResult> {
  const plan = planExec(projectRoot, command, args, { cwd: opts.cwd, handshake: opts.handshake });
  if (!plan.ok) throw new ExecRefused(plan.rule, plan.reason);
  return runPlanned(plan, projectRoot, { env: opts.env, timeoutMs: opts.timeoutMs });
}
