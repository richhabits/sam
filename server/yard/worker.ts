// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the worker
//
//  A SEPARATE OS PROCESS. This is the entire reason the yard exists: a build that
//  saturates a core has to be unable to make the assistant stop answering, and the
//  only honest way to guarantee that is to not run it on the same event loop. The
//  server enqueues and reads; this process claims and does the work. They meet only
//  in the job table.
//
//  The loop is deliberately dull: take one job, renew the claim while working, check
//  between steps whether the operator has asked it to stop, and record the outcome —
//  including the outcomes nobody enjoys. A worker that exits without recording why is
//  a worker that leaves a phantom in the queue, so every path here ends in a write.
// ─────────────────────────────────────────────────────────────

import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { JobStore, yardDir, type JobStep } from "./store.ts";
import { HEARTBEAT_MS, type FailureKind } from "./state.ts";
import { execInProject, writeInProject, resolveProjectWrite, isWithin } from "./exec.ts";
import { scrub } from "../scrub.ts";
import { runModel, type Tier } from "../models.ts";
import { runAgent } from "../agent.ts";
import { handleUnattended } from "../ask.ts";
import { createProject, checkpoint, restore, projectPath, projectsRoot, isManagedProject, updateManifest, MANIFEST } from "./managed.ts";
import { readEditable, selectContext, admissible, MAX_FILES } from "./context.ts";
import { applyEdits } from "./edits.ts";
import { normaliseSpec, specSummary } from "./spec.ts";
import { buildUntilGreen, describeOutcome } from "./loop.ts";
import { saveDiffs } from "./glass.ts";
import { planDeploy, urlFrom, smokeTest } from "./deploy.ts";

const IDLE_POLL_MS = 1000;
const LOCK_STALE_MS = 60_000;

// ── Single flight ───────────────────────────────────────────────────────────
// Two workers would both make progress and both be right, but the operator would
// see interleaved logs and double spend. A lock file with a pid is enough: a stale
// one (dead pid, or simply too old) is taken over rather than deferred to for ever.
export function lockPath(): string { return join(yardDir(), "worker.lock"); }

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function claimLock(now = Date.now()): boolean {
  const dir = yardDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = lockPath();
  const mine = JSON.stringify({ pid: process.pid, at: now });

  // EXCLUSIVE CREATE, not check-then-write. The old shape was:
  //     if (existsSync(p)) { …decide… }
  //     writeFileSync(p, mine); return true;
  // Two workers starting together both found no lock, both wrote, and both returned true —
  // the exact double flight this lock exists to prevent, and the one the comment above
  // describes: interleaved logs and double spend. `wx` fails if the file exists, so the
  // create is decided by the filesystem instead of by a gap between two calls.
  try {
    writeFileSync(p, mine, { flag: "wx" });
    return true;
  } catch { /* someone holds it — fall through and judge whether they still deserve to */ }

  try {
    const held = JSON.parse(readFileSync(p, "utf8"));
    const fresh = now - Number(held.at || 0) < LOCK_STALE_MS;
    if (fresh && held.pid !== process.pid && pidAlive(Number(held.pid))) return false;
  } catch { /* unreadable lock is a dead lock — take it */ }

  // Taking over a stale lock. Two workers can still decide that at the same instant, so the
  // write is CONFIRMED rather than assumed: whoever's pid is on disk afterwards is the holder,
  // and the loser backs off instead of both proceeding on a claim neither checked.
  writeFileSync(p, mine);
  try { return JSON.parse(readFileSync(p, "utf8")).pid === process.pid; } catch { return false; }
}
export function refreshLock(now = Date.now()) {
  try { writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, at: now })); } catch { /* best effort */ }
}
export function releaseLock() {
  try {
    const held = JSON.parse(readFileSync(lockPath(), "utf8"));
    if (held.pid === process.pid) unlinkSync(lockPath());
  } catch { /* not ours, or already gone */ }
}

// ── Job logs ────────────────────────────────────────────────────────────────
const LOG_CAP = 2 * 1024 * 1024;

export function jobLogPath(id: string): string { return join(yardDir(), "logs", `${id}.log`); }

export class JobLog {
  private written = 0;
  private capped = false;
  constructor(private path: string) {
    const dir = join(this.path, "..");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  write(line: string) {
    if (this.capped) return;
    // A job log records real command output — an install that echoes a token, a deploy
    // that prints a header. It goes to disk, so it is scrubbed on the way in rather than
    // on the way out: what is never written cannot leak later.
    const text = `[${new Date().toISOString()}] ${scrub(line)}\n`;
    if (this.written + text.length > LOG_CAP) {
      this.capped = true;
      try { appendFileSync(this.path, "\n— log truncated: this job produced more output than the yard keeps —\n"); } catch { /* disk gone */ }
      return;
    }
    this.written += text.length;
    try { appendFileSync(this.path, text); } catch { /* a job must not die because its log did */ }
  }
  tail(lines = 20): string[] {
    try { return readFileSync(this.path, "utf8").trim().split("\n").slice(-lines); } catch { return []; }
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────
// A handler receives the tools it is allowed to use and nothing else. `checkStop`
// is how a long handler stays interruptible: it throws when the operator has asked
// the job to stop, or when the meter has run out.

// `lost` means the job's row moved out from under the handler — reaped as abandoned,
// or stopped by the meter. It is NOT a synonym for a budget stop: reporting one as the
// other sent the operator hunting a spending limit that had nothing to do with it.
export class JobStopped extends Error {
  constructor(readonly why: "cancelled" | "budget" | "lost", readonly state?: string) {
    super(`job stopped: ${why}${state ? ` (now ${state})` : ""}`);
  }
}

export interface JobContext {
  id: string;
  payload: any;
  project: string | null;
  // Where this job's log lives. Handlers that produce an artefact worth keeping (the
  // build loop's diffs) put it beside the log rather than inventing their own home.
  logPath: string | null;
  log: (line: string) => void;
  // tier is optional and recorded once (first call that supplies it wins) — A6's free-
  // vs-paid split reads it straight off the job row, real attribution, never invented.
  spend: (tokens: number, tier?: string) => void;
  checkStop: () => void;
  // Declares a new step as "running", auto-finishing whichever step was running before
  // it as "done". The UI's live checklist comes straight from these — never a model
  // guessing after the fact. Optional per handler: a kind that never calls this just
  // shows no checklist, falling back to the raw log (same as before A3).
  step: (label: string) => void;
}
export type Handler = (ctx: JobContext) => Promise<string | void>;

export const HANDLERS: Record<string, Handler> = {
  // A job that does nothing, slowly, while reporting — the honest way to prove the
  // spine keeps the rest of SAM responsive under load.
  sleep: async (ctx) => {
    // `|| 5` here would turn an explicit 0 into 5 — a zero-length job is a legitimate
    // thing to ask for, and silently lengthening it would make the spine untestable.
    const asked = Number(ctx.payload?.seconds);
    const seconds = Math.min(Math.max(Number.isFinite(asked) ? asked : 5, 0), 600);
    const burn = !!ctx.payload?.burn;
    ctx.step(`sleeping ${seconds}s${burn ? " while burning a core" : ""}`);
    for (let i = 0; i < seconds; i++) {
      ctx.checkStop();
      if (burn) { const until = Date.now() + 1000; while (Date.now() < until) { /* deliberate load */ } }
      else await new Promise((r) => setTimeout(r, 1000));
      ctx.log(`tick ${i + 1}/${seconds}`);
    }
    return `slept ${seconds}s`;
  },
};

// Run a short sequence of confined commands inside one project. Every step goes through
// the executor, so a refusal stops the job rather than being written into its log as if
// it were output. A non-zero exit stops the sequence too: continuing past a failed
// install and reporting success is how a build lies about what it produced.
HANDLERS.run = async (ctx) => {
  // Either an explicit root, or the slug of a managed project — which is the form that
  // gets a checkpoint at the end, because only a managed project has somewhere to put one.
  const slug = String(ctx.payload?.slug || "");
  const root = slug ? projectPath(slug) : String(ctx.payload?.root || "");
  const steps: any[] = Array.isArray(ctx.payload?.steps) ? ctx.payload.steps : [];
  if (!root) throw Object.assign(new Error("a run job needs a project root or a slug"), { kind: "permanent" as FailureKind });
  // An explicit root (the no-slug form) must still live inside the yard's own projects
  // tree. A run job is not a licence to operate anywhere on disk the deny-list happens not
  // to name — confinement starts at the project, not at the crown-jewel blacklist.
  if (!slug && !isWithin(projectsRoot(), root)) {
    throw Object.assign(new Error("a run job's root must be a managed project inside the yard"), { kind: "permanent" as FailureKind });
  }
  if (!steps.length) throw Object.assign(new Error("a run job needs at least one step"), { kind: "permanent" as FailureKind });

  let last = "";
  for (const [i, step] of steps.entries()) {
    ctx.checkStop();
    const [command, ...args] = Array.isArray(step) ? step : [step?.command, ...(step?.args ?? [])];
    ctx.step(`${i + 1}/${steps.length}: ${command} ${args.join(" ")}`.trim());
    ctx.log(`step ${i + 1}/${steps.length}: ${command} ${args.join(" ")}`);
    const r = await execInProject(root, String(command), args.map(String), { cwd: ctx.payload?.cwd, env: ctx.payload?.env });
    for (const line of `${r.stdout}${r.stderr}`.split("\n").filter(Boolean).slice(0, 200)) ctx.log(`  ${line}`);
    if (r.truncated) ctx.log("  (output truncated)");
    if (r.code !== 0) throw new Error(`step ${i + 1} (${command}) exited ${r.code}`);
    last = `${command} ok`;
  }

  // A completed iteration checkpoints itself. The undo therefore exists before anyone
  // discovers they need it — which is the only time an undo is worth having. Deliberately
  // AFTER the steps succeeded: checkpointing a half-finished build records a state nobody
  // would ever want to return to.
  let mark = "";
  if (slug && isManagedProject(slug)) {
    ctx.step("checkpointing");
    const cp = await checkpoint(slug, String(ctx.payload?.message || `${steps.length} step${steps.length === 1 ? "" : "s"}: ${last}`));
    if (cp) { ctx.log(`checkpoint ${cp.sha.slice(0, 8)} — ${cp.message}`); mark = ` · checkpoint ${cp.sha.slice(0, 8)}`; }
    else ctx.log("nothing changed on disk — no checkpoint recorded");
  }
  return `${steps.length} step${steps.length === 1 ? "" : "s"} — ${last}${mark}`;
};

// ── The Playbook — a saved prompt as a job ──────────────────────────────────
// A4's missing piece: every other job kind does ONE specific thing (build, edit, deploy).
// This one runs an arbitrary, already-rendered prompt through the same agent loop the chat
// UI uses (server/agent.ts) — unattended, in the yard, instead of live in a conversation.
// Nothing new is invented for tool-calling or safety: it's the scheduler's own pattern
// (server/index.ts's startScheduler callback) moved into a job kind so a Playbook run gets
// a durable thread, a log, and a cost line instead of a fire-and-forget background call.
//
// Cost is APPROXIMATE — a rough chars/4 estimate of prompt+answer, not real per-call token
// accounting from inside the agent loop's own tool calls. A real meter (A6) needs runAgent
// to report spend as it goes; that's a bigger change than this slice, said plainly rather
// than faked with a precise-looking number.
const roughTokens = (s: string) => Math.ceil(String(s || "").length / 4);

HANDLERS["playbook.run"] = async (ctx) => {
  const prompt = String(ctx.payload?.prompt || "").trim();
  if (!prompt) throw Object.assign(new Error("a playbook run needs a rendered prompt"), { kind: "permanent" as FailureKind });

  ctx.step("working");
  const system = "You are SAM, running an unattended background task enqueued from a saved playbook. " +
    "Nobody is watching live — be direct, use whatever tools the request needs, and your final answer " +
    "should say plainly what you actually did (or, if you couldn't finish, exactly why).";
  const tier = (process.env.DEFAULT_TIER as Tier) || "free";
  ctx.spend(roughTokens(system) + roughTokens(prompt), tier);
  const r = await runAgent(system, prompt, tier);
  ctx.checkStop();
  ctx.spend(roughTokens(r.text || ""));

  if (r.kind === "final" && r.text) { ctx.log(r.text); return r.text.slice(0, 400); }

  // Reached a dangerous/confirm action with nobody live to approve it. Same fix the
  // scheduler already uses: raise it as an Ask out-of-band rather than silently dropping it
  // or (worse) reporting success when nothing ran.
  ctx.step("needs your OK");
  const a = handleUnattended(r, { tier, source: "yard", why: `a playbook run ("${prompt.slice(0, 80)}") needs this to continue` });
  if (a.kind === "deferred") { ctx.log(a.text); return a.text; }
  throw new Error("the agent stopped without a final answer and there was nothing to defer — this shouldn't happen");
};

// ── Managed projects as job kinds ───────────────────────────────────────────
// Creating, checkpointing and going back are all work the yard does, so they are jobs
// like any other: queued, logged, cancellable, and visible in the same place.

HANDLERS["project.create"] = async (ctx) => {
  const name = String(ctx.payload?.name || "").trim();
  if (!name) throw Object.assign(new Error("a project needs a name"), { kind: "permanent" as FailureKind });
  ctx.step(`creating "${name}"`);
  const m = await createProject(name, { spec: String(ctx.payload?.spec || "") });
  ctx.log(`created ${m.slug} at ${projectPath(m.slug)}`);
  return `created ${m.slug}`;
};

// The whole first iteration as ONE job: make the project, put something real in it, and
// checkpoint. One job rather than three because the slug does not exist until the first
// step has run, and queueing work that refers to a name nothing has produced yet is how
// a pipeline ends up depending on luck.
HANDLERS["project.build"] = async (ctx) => {
  const name = String(ctx.payload?.name || "").trim();
  if (!name) throw Object.assign(new Error("a build needs a name"), { kind: "permanent" as FailureKind });

  // A confirmed plan travels in the payload. It is normalised again here rather than
  // trusted: it arrives over the same HTTP surface as everything else, and a plan that
  // reached the job by some other route must not be able to write whatever it likes.
  const plan = ctx.payload?.plan ? normaliseSpec(ctx.payload.plan, name, name) : null;

  ctx.step(`creating "${name}"`);
  const m = await createProject(name, { spec: plan ? plan.summary : String(ctx.payload?.spec || name) });
  ctx.log(`created ${m.slug} at ${projectPath(m.slug)}`);
  if (plan) ctx.log(`plan: ${plan.kind} · ${plan.pages.length} page${plan.pages.length === 1 ? "" : "s"} · ${plan.stack.host}`);
  ctx.checkStop();

  // A plain page, written directly rather than shelled out for. It is deliberately not a
  // framework: this is the first iteration, it has to actually open in a browser, and a
  // dependency tree is something to add when the project asks for one.
  ctx.step("writing the first page");
  const dir = projectPath(m.slug);
  const title = m.name.replace(/[<>&]/g, "");
  writeFileSync(join(dir, "index.html"), page(title));
  // The plan is written into the project so the thing on disk carries what it was meant
  // to be. A build whose brief lives only in a chat log cannot be picked up later.
  writeFileSync(
    join(dir, "README.md"),
    plan
      ? `# ${title}\n\n${specSummary(plan)}\n\nBuilt by SAM. Open index.html.\n`
      : `# ${title}\n\n${m.spec}\n\nBuilt by SAM. Open index.html.\n`,
  );
  if (plan) writeFileSync(join(dir, "sam.plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  ctx.log(`wrote index.html and README.md${plan ? " and sam.plan.json" : ""}`);

  ctx.step("checkpointing");
  const cp = await checkpoint(m.slug, `Scaffold ${m.slug}`);
  if (cp) ctx.log(`checkpoint ${cp.sha.slice(0, 8)} — ${cp.message}`);
  return `built ${m.slug}${cp ? ` · checkpoint ${cp.sha.slice(0, 8)}` : ""}`;
};

function page(title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: radial-gradient(900px 500px at 50% -10%, rgba(240,130,78,.16), transparent 60%), #100E0C;
    color: #F3EDE4; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif;
    text-align: center; padding: 24px;
  }
  h1 { font-size: clamp(2rem, 8vw, 4rem); letter-spacing: -.04em; margin: 0 0 .4em; }
  p { color: #B8AFA4; font-size: 1.05rem; margin: 0; }
</style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>Built in the yard. Edit index.html to make it yours.</p>
  </main>
</body>
</html>
`;
}

// ── Building until it actually works ────────────────────────────────────────
// The difference between a builder and a code generator: this one runs what it wrote,
// reads what broke, and fixes that — bounded, checkpointed first, and honest when it
// runs out of attempts. The loop itself lives in loop.ts with every outside call
// injected; this handler is the wiring that gives it the job's log, meter and stop.
HANDLERS["project.loop"] = async (ctx) => {
  const slug = String(ctx.payload?.slug || "");
  const goal = String(ctx.payload?.goal || ctx.payload?.what || "").trim();
  if (!slug || !isManagedProject(slug)) throw Object.assign(new Error(`"${slug}" is not a managed project`), { kind: "permanent" as FailureKind });
  if (!goal) throw Object.assign(new Error("a build loop needs to say what it is building towards"), { kind: "permanent" as FailureKind });

  const dir = projectPath(slug);

  // The way back exists before the first byte, so an iteration that makes things worse
  // costs nothing to abandon.
  ctx.step("checkpointing the way back");
  const before = await checkpoint(slug, `before: ${goal.slice(0, 80)}`);
  ctx.log(before ? `checkpointed first: ${before.sha.slice(0, 8)}` : "already clean — the last checkpoint is the way back");
  ctx.checkStop();

  // Free tier by default, and the configured default when there is one — the same pattern
  // the spec and the playbook use. It is not only consistency: hardcoding "free" sent the
  // first drive of this loop to a cloud provider on a machine explicitly set to run local,
  // which is how a test spends an allowance nobody meant to spend.
  const tier = (process.env.DEFAULT_TIER as Tier) || "free";

  const outcome = await buildUntilGreen(dir, goal, {
    propose: async (system, prompt) => {
      const r = await runModel(tier, system, prompt, "code");
      // The tier the PROVIDER actually served, not the one asked for — a "free" request that
      // falls through to a local model really did stay on this machine, and the job row is
      // where anyone checks whether their code left it. Reported here because this is the
      // only place that knows; 0 tokens because the loop already counts them.
      ctx.spend(0, r.tier);
      ctx.log(`proposal from ${r.provider}`);
      return r.text;
    },
    log: ctx.log,
    step: ctx.step,
    spend: ctx.spend,
    checkStop: ctx.checkStop,
  });

  // Kept beside the job's log so the glass can show what changed long after the job's own
  // memory is gone. Written whether or not the loop succeeded — a failed build's diffs are
  // the more interesting ones, because they are what you undo.
  saveDiffs(ctx.logPath, outcome.diffs);

  if (outcome.diffs.length) {
    ctx.step("checkpointing the result");
    const after = await checkpoint(slug, `${outcome.ok ? "built" : "attempted"}: ${goal.slice(0, 80)}`);
    if (after) ctx.log(`checkpoint ${after.sha.slice(0, 8)}`);
  }

  // A loop that ran out of attempts FAILS the job. Returning a cheerful summary for a
  // build that does not work is the exact failure this whole movement is designed
  // against — the operator finds out in production instead of here.
  const said = describeOutcome(outcome);
  if (!outcome.ok) throw Object.assign(new Error(said), { kind: "permanent" as FailureKind });
  return said;
};

// ── Editing something that already exists ───────────────────────────────────
// The dangerous one, so it is built back-to-front: the way back exists BEFORE any
// change is attempted. Checkpoint, then read, then propose, then write, then
// checkpoint again. If the proposal is unusable nothing is written at all and the
// job fails saying so — a half-applied edit is worse than none, because it looks
// like it worked.

// SAM's own record of the project is not the model's to rewrite. Given the manifest as
// context, a model reasonably treats it as part of the work and renames it to match the
// edit — which silently breaks the one invariant everything else depends on: that the
// slug in the file matches the folder it sits in. Every later lookup would miss.
const NOT_THE_MODELS = new Set([MANIFEST, ".gitignore"]);

// Roughly what a model charges for this text. Approximate on purpose: the meter exists
// to stop a runaway, and a runaway is obvious at any sensible precision.
const estimate = (s: string) => Math.ceil(String(s || "").length / 4);

const EDIT_SYSTEM =
  "You edit ONE small web project. You are given every file that may be changed, and a request. " +
  "Return STRICT JSON: {\"files\":[{\"path\":\"relative/path\",\"content\":\"the COMPLETE new contents\"}],\"note\":\"one sentence\"}. " +
  "Rules: return ONLY files you actually changed; give the WHOLE file, never a fragment or a diff; " +
  "keep paths relative and inside the project; never touch .git; never invent dependencies. JSON only, no prose.";

// Pinpoint-edit mode (SAM_YARD_PATCH). Lets the model change PART of a file by naming an exact,
// unique passage — so it never reproduces the bytes it is not touching, and a large file becomes
// editable without a full rewrite. "files" (whole) is kept for new files and genuine rewrites.
const EDIT_SYSTEM_PATCH =
  "You edit ONE web project. You are given files and a request. PREFER PINPOINT EDITS: name an exact " +
  "passage to replace, so you never rewrite a file you are only partly changing. " +
  "Return STRICT JSON with either or both of: " +
  "\"edits\":[{\"path\":\"relative/path\",\"find\":\"an EXACT passage copied VERBATIM from the file\",\"replace\":\"its replacement\"}] " +
  "for changing existing files, and " +
  "\"files\":[{\"path\":\"relative/path\",\"content\":\"COMPLETE contents\"}] for NEW files or full rewrites. " +
  "Every \"find\" MUST appear EXACTLY ONCE in the file — copy enough surrounding text to be unique, or it is refused and nothing changes. " +
  "Keep paths relative and inside the project; never touch .git; never invent dependencies. Add \"note\":\"one sentence\". JSON only, no prose.";

HANDLERS["project.edit"] = async (ctx) => {
  const slug = String(ctx.payload?.slug || "");
  const what = String(ctx.payload?.what || "").trim();
  if (!slug || !isManagedProject(slug)) throw Object.assign(new Error(`"${slug}" is not a managed project`), { kind: "permanent" as FailureKind });
  if (!what) throw Object.assign(new Error("an edit needs to say what to change"), { kind: "permanent" as FailureKind });

  const dir = projectPath(slug);

  // The way back, first. Any uncommitted work is secured before this job touches a file.
  ctx.step("checkpointing the way back");
  const before = await checkpoint(slug, `before: ${what.slice(0, 80)}`);
  ctx.log(before ? `checkpointed first: ${before.sha.slice(0, 8)}` : "already clean — the last checkpoint is the way back");
  ctx.checkStop();

  // Read everything editable, then show only what this request implicates. Nothing is
  // ever cut short: an edit returns WHOLE files, so a model shown half a file writes
  // back half a file and the rest is silently deleted.
  ctx.step("reading the project's files");
  const existing = readEditable(dir, NOT_THE_MODELS);
  if (!existing.length) throw Object.assign(new Error("there are no editable files in this project"), { kind: "permanent" as FailureKind });

  // Pinpoint mode returns tiny edit blocks rather than whole files, so a bigger file can be shown
  // as context and still edited cheaply. The ceiling is raised only when the flag is on.
  const patchMode = process.env.SAM_YARD_PATCH === "1";
  const { offered, tooBig, leftOut } = selectContext(existing, what,
    patchMode ? { maxOne: 100_000, maxBytes: 100_000 } : {});
  if (!offered.length) throw Object.assign(new Error("no file in this project is small enough to edit whole"), { kind: "permanent" as FailureKind });
  ctx.log(`showing ${offered.length} of ${existing.length} file(s): ${offered.map((f) => f.path).join(", ")}`);
  // Said out loud rather than left implicit — a file left out is a file the edit cannot
  // change, and finding that out later by its absence is the worst way to learn it.
  if (leftOut.length) ctx.log(`not shown (less relevant to this request): ${leftOut.join(", ")}`);
  if (tooBig.length) ctx.log(`NOT SHOWN — too large to send whole, so they cannot be edited safely: ${tooBig.join(", ")}`);

  const prompt = [
    `Request: ${what}`, "",
    "Files you may change (complete contents):",
    ...offered.map((f) => `--- ${f.path} ---\n${f.content}`),
  ].join("\n");

  // Free tier by default, the configured default when there is one, vault-routed exactly
  // like everything else SAM does. Metered against the job's own ceiling so one runaway
  // edit cannot spend the allowance of the queue — and metered against the tier actually
  // used, since a meter told "free" while the call went elsewhere is worse than no meter.
  ctx.step("asking for a proposal");
  const sys = patchMode ? EDIT_SYSTEM_PATCH : EDIT_SYSTEM;
  const editTier = (process.env.DEFAULT_TIER as Tier) || "free";
  ctx.spend(estimate(sys) + estimate(prompt), editTier);
  const r = await runModel(editTier, sys, prompt, "code");
  ctx.spend(estimate(r.text));
  ctx.log(`proposal from ${r.provider}`);
  ctx.checkStop();

  let spec: any;
  try { spec = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] || r.text); }
  catch { throw new Error("the proposal was not valid JSON — nothing was changed"); }

  const proposed: any[] = Array.isArray(spec?.files) ? spec.files : [];
  const usable = proposed.filter((f) => f && typeof f.path === "string" && typeof f.content === "string" && f.content.length);

  // Pinpoint edits (flag-gated). Group by path and apply against the file AS SHOWN — a pinpoint
  // edit can only touch a file the model actually saw. All-or-nothing per file: if any block
  // cannot be placed exactly and uniquely, the file is left untouched and the reason is logged,
  // so a half-matched proposal can never leave a file in a state nobody chose.
  ctx.step("applying the edits");
  const patched: { path: string; content: string }[] = [];
  if (patchMode && Array.isArray(spec?.edits)) {
    const byPath = new Map<string, { find: string; replace: string }[]>();
    for (const e of spec.edits) {
      if (!e || typeof e.path !== "string" || typeof e.find !== "string" || typeof e.replace !== "string") continue;
      const path = e.path.replace(/^\.\//, "");
      const list = byPath.get(path) ?? [];
      list.push({ find: e.find, replace: e.replace });
      byPath.set(path, list);
    }
    for (const [path, blocks] of byPath) {
      const src = offered.find((f) => f.path === path);
      if (!src) { ctx.log(`left ${path} alone — a pinpoint edit can only change a file that was shown`); continue; }
      const out = applyEdits(src.content, blocks);
      if (!out.ok) { ctx.log(`left ${path} alone — ${out.failures.map((f) => f.why).join("; ").slice(0, 180)}`); continue; }
      patched.push({ path, content: out.content });
      ctx.log(`pinpoint: placed ${out.applied} edit(s) in ${path}`);
    }
  }

  // Whole-file entries apply only where a pinpoint edit did not already produce that path.
  const patchedPaths = new Set(patched.map((p) => p.path));
  const combined = [...patched, ...usable.filter((f) => !patchedPaths.has(String(f.path).replace(/^\.\//, "")))];
  const { write: allowed, refused } = admissible(combined, offered, existing, NOT_THE_MODELS);
  for (const r of refused) ctx.log(`left ${r.path} alone — ${r.why}`);
  if (!allowed.length) throw new Error("the proposal changed nothing this request implicated — nothing was written");

  // Every path is checked before ANY of them is written, so a bad one cannot leave the
  // project half-edited. Refusals throw, which fails the job with the reason intact.
  // admissible() vets path membership/editability but NOT filesystem confinement (symlink
  // resolution, the deny-list, .git), so the full resolution is pre-flighted here across
  // the whole batch before the first byte lands.
  const targets = allowed.slice(0, MAX_FILES);
  for (const f of targets) resolveProjectWrite(dir, f.path);
  for (const f of targets) writeInProject(dir, f.path, f.content);
  ctx.log(`wrote ${targets.map((f) => f.path).join(", ")}`);

  ctx.step("checkpointing the result");
  const after = await checkpoint(slug, what.slice(0, 100));
  if (!after) { ctx.log("the proposal matched what was already there — nothing changed"); return "no change was needed"; }
  ctx.log(`checkpoint ${after.sha.slice(0, 8)} — ${after.message}`);
  return `edited ${targets.length} file${targets.length === 1 ? "" : "s"} · checkpoint ${after.sha.slice(0, 8)}${spec?.note ? ` · ${String(spec.note).slice(0, 90)}` : ""}`;
};

// Putting a project on the internet. Checkpoints first, builds if the project needs it,
// deploys, then FETCHES the result — because a command that exited zero is not the same
// as a page that loads, and reporting a URL nobody checked is how a broken deploy gets
// called a success.
HANDLERS["project.deploy"] = async (ctx) => {
  const slug = String(ctx.payload?.slug || "");
  if (!slug || !isManagedProject(slug)) throw Object.assign(new Error(`"${slug}" is not a managed project`), { kind: "permanent" as FailureKind });
  const dir = projectPath(slug);

  ctx.step("checking the deploy is possible");
  const plan = planDeploy(dir, { production: ctx.payload?.production !== false });
  // A missing credential is permanent: retrying cannot conjure one, and a queue of
  // hopeful retries hides the one sentence that says what to do about it.
  if (!plan.ok) throw Object.assign(new Error(plan.reason), { kind: "permanent" as FailureKind });

  ctx.step("checkpointing the way back");
  const cp = await checkpoint(slug, `before deploying ${slug}`);
  if (cp) ctx.log(`checkpointed first: ${cp.sha.slice(0, 8)}`);
  ctx.log(`shape: ${plan.shape.reason}`);
  ctx.checkStop();

  if (plan.shape.buildCommand) {
    ctx.step(`building: ${plan.shape.buildCommand.join(" ")}`);
    const [cmd, ...args] = plan.shape.buildCommand;
    const built = await execInProject(dir, cmd, args, { timeoutMs: 10 * 60_000 });
    for (const line of `${built.stdout}${built.stderr}`.split("\n").filter(Boolean).slice(-40)) ctx.log(`  ${line}`);
    if (built.code !== 0) throw new Error(`the build failed (exit ${built.code}) — nothing was deployed`);
  }
  ctx.checkStop();

  ctx.step("deploying");
  ctx.log(`deploying: vercel ${plan.args.join(" ")}`);
  const out = await execInProject(dir, "vercel", plan.args, { env: plan.env, timeoutMs: 15 * 60_000 });
  for (const line of `${out.stdout}${out.stderr}`.split("\n").filter(Boolean).slice(-40)) ctx.log(`  ${line}`);
  if (out.code !== 0) throw new Error(`the deploy failed (exit ${out.code})`);

  const url = urlFrom(`${out.stdout}\n${out.stderr}`);
  if (!url) throw new Error("the deploy reported success but named no URL — refusing to claim it is live");

  ctx.step(`checking ${url} is really there`);
  ctx.log(`checking ${url} is really there…`);
  const smoke = await smokeTest(url);
  ctx.log(`  ${smoke.detail}`);
  updateManifest(slug, { issues: smoke.ok ? [] : [`the last deploy answered badly: ${smoke.detail}`] });
  if (!smoke.ok) throw new Error(`deployed to ${url}, but it is not serving properly — ${smoke.detail}`);

  await checkpoint(slug, `deployed ${slug}`);
  return `live at ${url}`;
};

HANDLERS["project.checkpoint"] = async (ctx) => {
  const slug = String(ctx.payload?.slug || "");
  ctx.step(`checkpointing ${slug}`);
  const cp = await checkpoint(slug, String(ctx.payload?.message || "checkpoint"));
  if (!cp) { ctx.log("nothing had changed — no checkpoint recorded"); return "nothing to record"; }
  ctx.log(`checkpoint ${cp.sha.slice(0, 8)} — ${cp.message}`);
  return `checkpoint ${cp.sha.slice(0, 8)}`;
};

HANDLERS["project.restore"] = async (ctx) => {
  const slug = String(ctx.payload?.slug || "");
  const sha = String(ctx.payload?.sha || "");
  ctx.step(`restoring ${slug} to ${sha ? sha.slice(0, 8) : "its last checkpoint"}`);
  const at = await restore(slug, sha);
  ctx.log(`restored ${slug} to ${at.sha.slice(0, 8)} — ${at.message}`);
  return `restored to ${at.sha.slice(0, 8)}`;
};

export function registerHandler(kind: string, fn: Handler) { HANDLERS[kind] = fn; }

// ── The loop ────────────────────────────────────────────────────────────────

export async function runOneJob(store: JobStore, now = () => Date.now()): Promise<string | null> {
  const job = store.claim(now(), jobLogPath);
  if (!job) return null;

  const log = new JobLog(job.logPath ?? jobLogPath(job.id));
  const beat = setInterval(() => { store.heartbeat(job.id); refreshLock(); }, HEARTBEAT_MS);

  // Steps this attempt has declared, in order. Starts empty even on a retry (the store
  // clears steps_json when it requeues a failed job) — a fresh attempt gets a fresh
  // checklist, not the previous attempt's failure still sitting on screen.
  const steps: JobStep[] = [];
  const finalizeStep = (state: JobStep["state"], error?: string) => {
    const last = steps[steps.length - 1];
    if (last?.state !== "running") return;
    last.state = state;
    if (error) last.error = error.slice(0, 300);
    store.setSteps(job.id, steps);
  };

  const ctx: JobContext = {
    id: job.id, payload: job.payload, project: job.project,
    logPath: job.logPath,
    log: (line) => log.write(line),
    spend: (tokens, tier) => {
      if (tier) store.setTier(job.id, tier);
      if (store.addCost(job.id, tokens).stopped) throw new JobStopped("budget");
    },
    checkStop: () => {
      // Renew the claim HERE, not only on a timer. A handler that pegs a core blocks
      // this process's own timers, so the interval below never fires, the claim goes
      // stale and the reaper kills a job that was working perfectly. Tying the renewal
      // to the stop-check makes the two disciplines one: a handler that can be
      // interrupted is, by the same act, a handler that proves it is alive.
      store.heartbeat(job.id);
      if (store.isCancelRequested(job.id)) throw new JobStopped("cancelled");
      const j = store.get(job.id);
      if (j && j.state !== "running") throw new JobStopped(j.state === "cancelled" ? "cancelled" : "lost", j.state);
    },
    step: (label) => {
      finalizeStep("done");
      steps.push({ label, state: "running", at: Date.now() });
      store.setSteps(job.id, steps);
    },
  };

  try {
    log.write(`claimed ${job.kind} (attempt ${job.attempts})`);
    const handler = HANDLERS[job.kind];
    if (!handler) throw Object.assign(new Error(`the yard has no handler for "${job.kind}"`), { kind: "permanent" as FailureKind });
    const result = await handler(ctx);
    ctx.checkStop();
    finalizeStep("done");
    log.write(`done: ${result ?? "ok"}`);
    store.finish(job.id);
    return job.id;
  } catch (e: any) {
    if (e instanceof JobStopped) {
      finalizeStep("stopped");
      log.write(`stopped: ${e.why}${e.state ? ` — the job is now ${e.state}` : ""}`);
      // A budget stop has already been recorded by the meter; only a cancel still
      // needs acknowledging. Guarded because the state may already have moved.
      if (e.why === "cancelled" && store.get(job.id)?.state === "running") store.acknowledgeCancel(job.id);
      return job.id;
    }
    const kind: FailureKind = e?.kind === "permanent" ? "permanent" : "transient";
    finalizeStep("failed", String(e?.message || e));
    log.write(`failed (${kind}): ${e?.message || e}`);
    if (store.get(job.id)?.state === "running") store.fail(job.id, String(e?.message || e), kind);
    return job.id;
  } finally {
    clearInterval(beat);
  }
}

// A worker exists to serve one supervisor. If that supervisor dies, this process is
// reparented to init and would otherwise keep running for ever — claiming jobs, holding
// the lock, and quietly accumulating one orphan per restart until something looks at the
// process list. Noticing is cheap, so it is checked every time round the loop.
export function orphaned(): boolean {
  return process.ppid === 1;
}

export async function workerLoop(store: JobStore, opts: { stop?: () => boolean; isOrphaned?: () => boolean } = {}) {
  const stop = opts.stop ?? (() => false);
  const alone = opts.isOrphaned ?? orphaned;
  while (!stop()) {
    if (alone()) {
      console.log("the yard: the server that started this worker is gone — standing down");
      releaseLock();
      return;
    }
    store.reapAbandoned();
    const did = await runOneJob(store);
    if (!did && !stop()) await new Promise((r) => setTimeout(r, IDLE_POLL_MS));
  }
}

// ── Entrypoint ──────────────────────────────────────────────────────────────
// Only when run directly. Importing this module (the server does, for its handlers)
// must never start a second worker.
// Matches BOTH shapes this file is launched as: `server/yard/worker.ts` from source and
// `dist/yard-worker.mjs` once bundled. Missing the bundled name meant the built worker
// loaded, started nothing, and exited 0 — which the supervisor dutifully retried for ever.
export function isWorkerEntrypoint(argv1: string | undefined): boolean {
  if (!argv1) return false;
  return /yard[/\\]worker\.(ts|mjs|js)$/.test(argv1) || /[/\\]yard-worker\.mjs$/.test(argv1);
}
const runDirectly = isWorkerEntrypoint(process.argv[1]);
if (runDirectly) {
  if (!claimLock()) {
    console.log("the yard: another worker already holds the lock — standing down");
    process.exit(0);
  }
  const store = new JobStore();
  let stopping = false;
  const shutdown = () => { stopping = true; releaseLock(); store.close(); process.exit(0); };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  console.log(`the yard: worker up (pid ${process.pid})`);
  workerLoop(store, { stop: () => stopping }).catch((e) => {
    console.error("the yard: worker loop died —", e?.message || e);
    releaseLock();
    process.exit(1);
  });
}
