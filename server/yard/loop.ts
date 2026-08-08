// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — building until it works
//
//  A single-shot edit is a guess that nobody checks. The loop is what turns it into a
//  build: write, RUN it, read what broke, fix that, run again. The difference between a
//  builder and a code generator is entirely this — one hands you something that looks
//  right, the other hands you something it has watched work.
//
//  Three rules shape it, and all three exist because of how this fails in the field.
//
//  It STOPS. A loop that self-fixes can also self-loop, and the products that meter this
//  charge for every failed attempt. Bounded by iterations, by the job's own cost ceiling,
//  and by whether the last attempt actually improved anything — repeating a fix that
//  changed nothing is the signature of a model going in circles, and it is cheaper to say
//  so than to buy another round of it.
//
//  It CHECKPOINTS BEFORE, not after. The way back exists before the first byte is
//  written, so an iteration that makes things worse costs nothing to abandon.
//
//  It REPORTS THE TRUTH. A loop that exhausts its iterations returns what still fails,
//  not a summary that reads like success. The whole failure mode being designed against
//  is "it said it fixed it three times and it was broken in production".
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execInProject, writeInProject, resolveProjectWrite, ExecRefused, type ExecResult } from "./exec.ts";
import { readEditable, selectContext, admissible, MAX_FILES } from "./context.ts";
import { applyEdits } from "./edits.ts";
import { indexProject, renderIndex } from "./tree.ts";
import { diffFiles, summariseAll, type FileDiff } from "./diff.ts";
import { MANIFEST } from "./managed.ts";

// SAM's own record of the project is not the model's to rewrite — the slug inside it is
// the invariant every later lookup depends on.
export const NOT_THE_MODELS = new Set([MANIFEST, ".gitignore"]);

// Deliberately small. Each iteration is a model call plus a build, and the value of a
// fifth attempt at something four attempts could not fix is close to zero.
export const MAX_ITERATIONS = 4;

export interface Verify { command: string; args: string[] }

// How a project is checked. Chosen from what is actually in the project rather than
// configured, because a verify command nobody set is a verify command that never runs.
export function verifyFor(dir: string): Verify | null {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;      // a plain HTML project has nothing to run
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts ?? {};
    // Build before test: a project that does not compile cannot meaningfully be tested,
    // and the compiler's error is the more useful one to hand back.
    for (const name of ["build", "test", "typecheck", "lint"]) {
      if (typeof scripts[name] === "string" && scripts[name].trim()) return { command: "npm", args: ["run", name] };
    }
  } catch { /* an unreadable package.json is the same as none for this purpose */ }
  return null;
}

export function needsInstall(dir: string): boolean {
  return existsSync(join(dir, "package.json")) && !existsSync(join(dir, "node_modules"));
}

// What went wrong, small enough to send back. The tail matters more than the head: a
// build prints its progress first and its failure last, and sending the first 2KB of a
// successful-looking log is how a fix gets aimed at nothing.
export function failureText(r: ExecResult, limit = 3_000): string {
  const merged = [r.stderr, r.stdout].filter(Boolean).join("\n").trim();
  if (merged.length <= limit) return merged;
  return `…\n${merged.slice(-limit)}`;
}

export interface Attempt {
  iteration: number;
  ok: boolean;
  wrote: string[];
  diffs: FileDiff[];
  error: string | null;
  note: string;
}

export interface LoopOutcome {
  ok: boolean;
  iterations: number;
  attempts: Attempt[];
  diffs: FileDiff[];          // every change the loop made, in order
  stopped: "verified" | "no-verify" | "exhausted" | "stalled" | "refused";
  lastError: string | null;
}

const SYSTEM =
  "You are fixing ONE small web project so that its build passes. " +
  "You are given an index of every file in the project, the contents of the files that may be changed, " +
  "and the exact error output. " +
  "Return STRICT JSON with either or both of: " +
  "\"edits\":[{\"path\":\"relative/path\",\"find\":\"an EXACT passage copied VERBATIM from a file shown\",\"replace\":\"its replacement\"}] " +
  "and \"files\":[{\"path\":\"relative/path\",\"content\":\"COMPLETE contents\"}] for new files or full rewrites. " +
  "Every \"find\" MUST appear EXACTLY ONCE in that file. " +
  "Fix the CAUSE of the error shown — do not restyle, do not tidy, do not add features. " +
  "Add \"note\":\"one sentence saying what you changed and why\". JSON only, no prose.";

export interface LoopDeps {
  // Injected so the loop is testable without a provider and without a network. Everything
  // that talks to the outside world arrives through here.
  propose: (system: string, prompt: string) => Promise<string>;
  log: (line: string) => void;
  step: (label: string) => void;
  spend: (tokens: number, tier?: string) => void;
  checkStop: () => void;
}

const estimate = (s: string) => Math.ceil(String(s || "").length / 4);

// Parse a proposal into writable content. Shares the shape `project.edit` already uses —
// pinpoint edits preferred, whole files allowed — so a model that can do one can do both.
export function readProposal(text: string, offered: { path: string; content: string }[]): { path: string; content: string }[] | null {
  let parsed: any;
  try { parsed = JSON.parse(String(text || "").match(/\{[\s\S]*\}/)?.[0] || text); }
  catch { return null; }

  const out: { path: string; content: string }[] = [];
  const done = new Set<string>();

  if (Array.isArray(parsed?.edits)) {
    const byPath = new Map<string, { find: string; replace: string }[]>();
    for (const e of parsed.edits) {
      if (!e || typeof e.path !== "string" || typeof e.find !== "string" || typeof e.replace !== "string") continue;
      const path = e.path.replace(/^\.\//, "");
      byPath.set(path, [...(byPath.get(path) ?? []), { find: e.find, replace: e.replace }]);
    }
    for (const [path, blocks] of byPath) {
      const src = offered.find((f) => f.path === path);
      if (!src) continue;                       // a pinpoint edit can only touch a file that was shown
      const applied = applyEdits(src.content, blocks);
      if (!applied.ok) continue;                // all-or-nothing per file — never half-placed
      out.push({ path, content: applied.content });
      done.add(path);
    }
  }

  if (Array.isArray(parsed?.files)) {
    for (const f of parsed.files) {
      if (!f || typeof f.path !== "string" || typeof f.content !== "string" || !f.content.length) continue;
      const path = f.path.replace(/^\.\//, "");
      if (!done.has(path)) out.push({ path, content: f.content });
    }
  }

  return out.length ? out : null;
}

export function noteFrom(text: string): string {
  try {
    const n = JSON.parse(String(text || "").match(/\{[\s\S]*\}/)?.[0] || text)?.note;
    return typeof n === "string" ? n.slice(0, 140) : "";
  } catch { return ""; }
}

// Write a batch and record what each write actually changed. Every path is resolved
// before ANY byte lands, so a bad path cannot leave the project half-written.
function writeBatch(dir: string, files: { path: string; content: string }[]): FileDiff[] {
  const targets = files.slice(0, MAX_FILES);
  for (const f of targets) resolveProjectWrite(dir, f.path);
  const diffs: FileDiff[] = [];
  for (const f of targets) {
    const full = join(dir, f.path);
    const before = existsSync(full) ? readFileSync(full, "utf8") : null;
    writeInProject(dir, f.path, f.content);
    diffs.push(diffFiles(f.path, before, f.content));
  }
  return diffs;
}

// ── The loop ────────────────────────────────────────────────────────────────

export async function buildUntilGreen(dir: string, goal: string, deps: LoopDeps, opts: { maxIterations?: number } = {}): Promise<LoopOutcome> {
  const maxIterations = opts.maxIterations ?? MAX_ITERATIONS;
  const attempts: Attempt[] = [];
  const allDiffs: FileDiff[] = [];

  const verify = verifyFor(dir);
  if (!verify) {
    // Honest, not a silent pass. A project with nothing to run is not a project that
    // built successfully — it is one that cannot be checked, and saying "green" here
    // would be the exact dishonesty this loop exists to avoid.
    deps.log("nothing in this project can be run to check it — no build, test or typecheck script");
    return { ok: false, iterations: 0, attempts, diffs: allDiffs, stopped: "no-verify", lastError: null };
  }

  if (needsInstall(dir)) {
    deps.step("installing dependencies");
    try {
      const r = await execInProject(dir, "npm", ["install", "--no-audit", "--no-fund"], { timeoutMs: 300_000 });
      deps.log(r.code === 0 ? "dependencies installed" : `npm install exited ${r.code}`);
    } catch (e) {
      if (e instanceof ExecRefused) {
        deps.log(`refused to install: ${e.message}`);
        return { ok: false, iterations: 0, attempts, diffs: allDiffs, stopped: "refused", lastError: e.message };
      }
      throw e;
    }
    deps.checkStop();
  }

  let lastError: string | null = null;

  for (let i = 1; i <= maxIterations; i++) {
    deps.checkStop();
    deps.step(i === 1 ? "running the build" : `fixing and running again (${i} of ${maxIterations})`);

    let result: ExecResult;
    try {
      result = await execInProject(dir, verify.command, verify.args, { timeoutMs: 300_000 });
    } catch (e) {
      if (e instanceof ExecRefused) {
        deps.log(`refused to run the check: ${e.message}`);
        return { ok: false, iterations: i - 1, attempts, diffs: allDiffs, stopped: "refused", lastError: e.message };
      }
      throw e;
    }

    if (result.code === 0) {
      deps.log(`${verify.command} ${verify.args.join(" ")} passed`);
      return { ok: true, iterations: i - 1, attempts, diffs: allDiffs, stopped: "verified", lastError: null };
    }

    const error = failureText(result);
    lastError = error;
    deps.log(`check failed (exit ${result.code})`);

    // The last iteration is spent finding out whether the previous fix worked. Asking for
    // another fix nobody will run is spending money to produce something unverified.
    if (i === maxIterations) break;

    // Show the whole project, edit only what the error implicates. The index is what stops
    // a fix from inventing a file that already exists; the scope is what stops it from
    // rewriting things nobody asked about.
    const everything = readEditable(dir, NOT_THE_MODELS);
    if (!everything.length) {
      deps.log("there are no editable files to fix");
      break;
    }
    const { offered } = selectContext(everything, `${goal}\n${error}`, { maxOne: 100_000, maxBytes: 100_000 });
    if (!offered.length) {
      deps.log("no file is small enough to fix safely");
      break;
    }

    const prompt = [
      `Goal: ${goal}`, "",
      "Every file in the project:",
      renderIndex(indexProject(dir)), "",
      `The check that failed: ${verify.command} ${verify.args.join(" ")}`,
      "Its output:", error, "",
      "Files you may change (complete contents):",
      ...offered.map((f) => `--- ${f.path} ---\n${f.content}`),
    ].join("\n");

    // No tier here. This fires BEFORE the model has run, so any tier named at this point is
    // a guess — and because the job row keeps the FIRST tier it is given, a guess here is
    // the one that sticks and the truth never lands. It said "free" for work that ran wholly
    // on-device, which is exactly the local-vs-cloud distinction the row exists to answer.
    // Whoever actually runs the model reports what it was; see propose() in worker.ts.
    deps.spend(estimate(SYSTEM) + estimate(prompt));
    const raw = await deps.propose(SYSTEM, prompt);
    deps.spend(estimate(raw));
    deps.checkStop();

    const proposal = readProposal(raw, offered);
    if (!proposal) {
      deps.log("the proposal could not be used — nothing was written");
      attempts.push({ iteration: i, ok: false, wrote: [], diffs: [], error, note: "" });
      break;
    }

    const { write: allowed, refused } = admissible(proposal, offered, everything, NOT_THE_MODELS);
    for (const r of refused) deps.log(`left ${r.path} alone — ${r.why}`);

    if (!allowed.length) {
      // Going in circles. `admissible` refuses a file returned byte-for-byte unchanged, so
      // a proposal where EVERY file came back unchanged is a model handing over its own
      // input again — it will fail the same way, and the honest thing is to stop rather
      // than buy three more rounds of the same answer. Caught here rather than after
      // writing, because there is nothing to write.
      const circling = refused.length > 0 && refused.every((r) => r.why === "unchanged");
      attempts.push({ iteration: i, ok: false, wrote: [], diffs: [], error, note: noteFrom(raw) });
      if (circling) {
        deps.log("that fix returned the files unchanged — stopping rather than repeating it");
        return { ok: false, iterations: i, attempts, diffs: allDiffs, stopped: "stalled", lastError };
      }
      deps.log("the proposal changed nothing the error implicated — nothing was written");
      break;
    }

    const diffs = writeBatch(dir, allowed);
    allDiffs.push(...diffs);
    const note = noteFrom(raw);
    deps.log(`${summariseAll(diffs)}${note ? ` · ${note}` : ""}`);
    attempts.push({ iteration: i, ok: true, wrote: diffs.map((d) => d.path), diffs, error, note });
  }

  return { ok: false, iterations: attempts.length, attempts, diffs: allDiffs, stopped: "exhausted", lastError };
}

// What the job says when it is done. A loop that ran out of attempts reports what still
// fails — never a sentence that could be mistaken for success.
export function describeOutcome(o: LoopOutcome): string {
  if (o.ok) return `built and verified${o.iterations ? ` after ${o.iterations} fix${o.iterations === 1 ? "" : "es"}` : ""} · ${summariseAll(o.diffs)}`;
  if (o.stopped === "no-verify") return "wrote the files, but there is nothing in this project to run — NOT verified";
  if (o.stopped === "refused") return `stopped: ${o.lastError ?? "a command was refused"}`;
  if (o.stopped === "stalled") return `stopped after ${o.iterations} attempt(s) — the fixes stopped changing anything. Still failing: ${(o.lastError ?? "").slice(0, 200)}`;
  return `still failing after ${o.iterations} attempt(s): ${(o.lastError ?? "unknown").slice(0, 300)}`;
}
