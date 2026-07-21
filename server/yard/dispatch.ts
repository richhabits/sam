// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — answering a routed message
//
//  Turns a reading into a job and an immediate, honest sentence. Nothing here waits
//  for a build to finish: the whole point of the spine is that the assistant keeps
//  talking while work happens, so this hands back a job to look at and returns.
//
//  Every reply says what was actually done — the project it made, the identifier to
//  ask about later. A cheerful "I'm on it" that names nothing is how you end up unable
//  to tell a job that is running from one that never started.
// ─────────────────────────────────────────────────────────────

import type { Reading } from "./intent.ts";
import type { JobStore, Job } from "./store.ts";
import { isClaimForfeit } from "./state.ts";
import { JobLog } from "./worker.ts";

function describe(job: Job, now: number): string {
  const spent = job.costBudget ? ` · ${job.costTokens}/${job.costBudget} tokens` : job.costTokens ? ` · ${job.costTokens} tokens` : "";
  switch (job.state) {
    case "queued": return `waiting to start${spent}`;
    case "running": return isClaimForfeit(job, now)
      ? `RUNNING but it has stopped reporting — it may have died${spent}`
      : `building now${spent}`;
    case "done": return `finished${spent}`;
    case "failed": return `failed — ${job.lastError ?? "no reason recorded"}${spent}`;
    case "cancelled": return `cancelled${spent}`;
  }
}

// The status answer, read straight from the table rather than from anything remembered.
export function statusReply(store: JobStore, now = Date.now()): string {
  const recent = store.list(undefined, 5);
  if (!recent.length) return "Nothing has been built yet — the yard is empty.";

  const live = recent.find((j) => j.state === "running") ?? recent.find((j) => j.state === "queued");
  const lines = recent.map((j) => `• ${j.kind}${j.project ? ` (${j.project})` : ""} — ${describe(j, now)}  [${j.id}]`);

  let head: string;
  if (live?.state === "running") head = isClaimForfeit(live, now) ? "A job is marked running but has stopped reporting." : "One job is building right now.";
  else if (live?.state === "queued") head = "Nothing is building; one job is waiting.";
  else head = "Nothing is building at the moment.";

  const tail = live?.logPath ? new JobLog(live.logPath).tail(3) : [];
  return [head, ...lines, ...(tail.length ? ["", "Latest from its log:", ...tail.map((l) => `  ${l}`)] : [])].join("\n");
}

// Turn a confident reading into work. Returns the sentence to say back, or null to let
// the ordinary chat path handle it after all.
export async function answerRouted(r: Reading, store: JobStore, now = Date.now()): Promise<string | null> {
  if (r.intent === "JOB_STATUS") return statusReply(store, now);

  if (r.intent === "BUILD_NEW") {
    const name = r.name || "new project";
    // ONE job that does the whole first iteration — make the project, put a real page in
    // it, checkpoint. Queued rather than awaited: the point of the spine is that this
    // sentence comes back immediately and the building happens elsewhere.
    const create = store.enqueue("project.build", { name, spec: r.name }, { project: name });
    return [
      `Starting a build: **${name}**.`,
      `It's queued in the yard as \`${create.id}\` — I'll keep working while it runs.`,
      `Ask me "status" any time to see how it's getting on.`,
    ].join("\n");
  }

  if (r.intent === "EDIT_EXISTING" && r.slug) {
    const job = store.enqueue("project.checkpoint", { slug: r.slug, message: `before: ${String(r.what || "an edit").slice(0, 80)}` }, { project: r.slug });
    return [
      `Noted for **${r.slug}**: ${String(r.what || "").slice(0, 140)}`,
      `I've checkpointed it first (\`${job.id}\`) so there's a way back before anything changes.`,
      `Editing an existing project isn't wired up yet — that's the next piece of the yard, and I'd rather say so than pretend it happened.`,
    ].join("\n");
  }

  return null;
}
