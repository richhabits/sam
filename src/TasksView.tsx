import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getYard, getYardJob, enqueueYardJob, cancelYardJob, retryYardJob, raiseYardJobBudget, getYardProjects,
  getPlaybooks, savePlaybook, deletePlaybook, importPlaybook, runPlaybook,
  getYardProject, getYardProjectFile, yardFileUrl,
} from "./lib/api";
import Icon from "./Icon";
import PairPrompt from "./PairPrompt";
import { renderMarkdown } from "./lib/md";

// THE FACE, Tasks half — every yard job as a durable, revisitable thread, in the same
// app shell the Agent (chat) lives in. Read-only data comes straight from the job table
// (/api/yard, /api/yard/job/:id) — no new store, this is a rendering problem, not a
// build problem. Starting/stopping work still goes through the yard's own trust gate
// (loopback, or a paired device — see server/http-guards.ts).

type JobStep = { label: string; state: "running" | "done" | "failed" | "stopped"; at: number; error?: string };

type Job = {
  id: string; kind: string; payload: any;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  attempts: number; createdAt: number; startedAt: number | null; finishedAt: number | null;
  heartbeatAt: number | null; costTokens: number; costBudget: number | null;
  lastError: string | null; failureKind: string | null; cancelRequested: boolean;
  logPath: string | null; project: string | null; steps: JobStep[]; tier: string | null;
};

type Filter = "all" | "queued" | "running" | "failed" | "done" | "cancelled";
const FILTERS: Filter[] = ["all", "running", "queued", "failed", "done", "cancelled"];

// A job needs a name before it needs a plan. Deterministic from kind + payload for now —
// a cheap-model-generated title is a nicety, not what makes the list legible.
function titleFor(j: Job): string {
  const p = j.payload || {};
  switch (j.kind) {
    case "project.build": return `Build: ${p.name || j.project || j.id}`;
    case "project.create": return `Create: ${p.name || j.id}`;
    case "project.edit": return `Edit ${p.slug || j.project || "project"}: ${String(p.what || "").slice(0, 60)}`;
    case "project.deploy": return `Deploy ${p.slug || j.project || j.id}`;
    case "project.checkpoint": return `Checkpoint ${p.slug || j.project || j.id}`;
    case "project.restore": return `Restore ${p.slug || j.project || j.id}`;
    default: return j.project ? `${j.kind} · ${j.project}` : j.kind;
  }
}

const STATUS_META: Record<Job["state"], { label: string; icon: any; color: string }> = {
  queued: { label: "Waiting to start", icon: "clock", color: "var(--muted)" },
  running: { label: "Running", icon: "pulse", color: "var(--accent)" },
  done: { label: "Done", icon: "check", color: "#3FAE5C" },
  failed: { label: "Failed", icon: "warn", color: "#E5484D" },
  cancelled: { label: "Cancelled", icon: "ban", color: "var(--muted)" },
};

// Same grace window as the worker's own heartbeat check (server/yard/state.ts
// HEARTBEAT_GRACE_MS) — duplicated here because the client has no reason to import
// server code. If that constant ever moves, this is the other place to update it.
const HEARTBEAT_GRACE_MS = 30_000;
function isStale(j: Job, now: number): boolean {
  if (j.state !== "running") return false;
  const last = j.heartbeatAt ?? j.startedAt;
  return last == null || now - last > HEARTBEAT_GRACE_MS;
}

function when(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function elapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function cost(j: Job): string {
  if (!j.costTokens && !j.costBudget) return "—";
  return j.costBudget ? `${j.costTokens.toLocaleString()} / ${j.costBudget.toLocaleString()}` : j.costTokens.toLocaleString();
}

const card: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" };
const btn: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius-sm)", padding: "6px 11px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };

export default function TasksView({ openNewOnMount, onOpenedNew }: { openNewOnMount?: boolean; onOpenedNew?: () => void } = {}) {
  const [on, setOn] = useState<boolean | null>(null);
  const [refused, setRefused] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [meter, setMeter] = useState<{ todayTokens: number; weekTokens: number; byTier: Record<string, number> } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ job: Job; log: string[] } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());
  const [newOpen, setNewOpen] = useState(false);
  const [playbooksOpen, setPlaybooksOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { document.title = "Tasks · SAM"; }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: onOpenedNew is a fresh closure every parent render; keying off it would re-fire this on every re-render instead of once per genuine intent change
  useEffect(() => {
    if (openNewOnMount) { setNewOpen(true); onOpenedNew?.(); }
  }, [openNewOnMount]);

  const refresh = useCallback(() => {
    getYard().then((r: any) => {
      setOn(!!r.on);
      setRefused(false);
      setJobs(r.recent || []);
      setMeter(r.meter || null);
      setNow(Date.now());
    }).catch((e: any) => {
      // A REFUSAL IS NOT A TRANSIENT FAILURE. /api/yard answers an untrusted browser with 403 and
      // no `refused` field, so `setRefused(!!r.refused)` could never once be true — the
      // "pair this browser" panel below has been unreachable since it was written. The refusal
      // instead fell through to "the yard is off", which is a different and wrong thing to say.
      //
      // It got worse when api.ts started throwing on a non-OK response (correctly — that change
      // is what stopped 47 refused actions reporting success): the throw landed in this catch,
      // `on` stayed null, and the screen showed "Looking…" forever. A spinner that never resolves
      // is the least useful of the three possible answers.
      if (e?.locked || e?.status === 401 || e?.status === 403) { setRefused(true); setOn(false); return; }
      /* genuinely transient — the next poll tries again */
    });
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let stop = false;
    const pull = () => getYardJob(selected).then((r: any) => { if (!stop && r.job) setDetail(r); }).catch(() => { /* transient fetch failure — the next poll tries again */ });
    pull();
    const iv = setInterval(pull, 2000);
    return () => { stop = true; clearInterval(iv); };
  }, [selected]);

  const filtered = jobs
    .filter((j) => filter === "all" || j.state === filter)
    .filter((j) => !query.trim() || titleFor(j).toLowerCase().includes(query.trim().toLowerCase()));

  const kill = async (id: string) => {
    setErr("");
    try { await cancelYardJob(id); refresh(); if (selected === id) getYardJob(id).then((r: any) => r.job && setDetail(r)); }
    catch (e: any) { setErr(e?.message || "couldn't stop that job"); }
  };
  const retry = async (id: string) => {
    setErr("");
    try { await retryYardJob(id); refresh(); }
    catch (e: any) { setErr(e?.message || "couldn't retry that job"); }
  };
  const raiseBudget = async (id: string, budget: number) => {
    setErr("");
    try { await raiseYardJobBudget(id, budget); refresh(); if (selected === id) getYardJob(id).then((r: any) => r.job && setDetail(r)); }
    catch (e: any) { setErr(e?.message || "couldn't raise that budget"); }
  };

  if (on === null) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>Looking…</div>;

  if (refused) {
    return (
      <div style={{ margin: "auto", maxWidth: 420, textAlign: "center", padding: 44 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>This device isn't paired yet</div>
        <div style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.6, marginBottom: 14 }}>
          The yard is there — the read was refused, not empty. Pair this browser once and Tasks works from any tab, including your phone.
        </div>
        <PairPrompt />
      </div>
    );
  }

  if (!on) {
    return (
      <div style={{ margin: "auto", maxWidth: 420, textAlign: "center", padding: 44 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>The yard is off</div>
        <div style={{ color: "var(--muted)", fontSize: 13.5, lineHeight: 1.6 }}>
          Set <code>SAM_YARD=1</code> and restart SAM to turn on task assignment and tracking.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ position: "relative", flex: "0 0 240px" }}>
          <input
            value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks…"
            style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 10px 7px 28px", color: "var(--text)", fontSize: 13 }}
          />
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", opacity: 0.5 }}><Icon name="search" size={13} /></span>
        </div>
        <div style={{ display: "flex", gap: 4 }} role="tablist">
          {FILTERS.map((f) => (
            <button type="button" key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
              style={{ ...btn, background: filter === f ? "var(--accent-soft)" : "var(--bg)", borderColor: filter === f ? "var(--accent)" : "var(--border)", color: filter === f ? "var(--accent-text, var(--accent))" : "var(--muted)", textTransform: "capitalize" }}>
              {f}{f !== "all" ? ` (${jobs.filter((j) => j.state === f).length})` : ""}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={() => setPlaybooksOpen(true)}>
          <Icon name="book" size={12} /> Playbooks
        </button>
        <button type="button" style={{ ...btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }} onClick={() => setNewOpen(true)}>
          <Icon name="plus" size={12} /> New task
        </button>
      </div>

      {meter && <TaskMeter meter={meter} />}

      {err && <div style={{ margin: "10px 16px 0", color: "#E5484D", fontSize: 12.5 }}>{err}</div>}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: "1 1 55%", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {!filtered.length && jobs.length === 0 && (
            <FirstRunCards onNewTask={() => setNewOpen(true)} onPlaybooks={() => setPlaybooksOpen(true)} />
          )}
          {!filtered.length && jobs.length > 0 && (
            <div style={{ ...card, textAlign: "center", padding: 40, color: "var(--muted)", fontSize: 13.5 }}>
              No tasks match that filter or search.
            </div>
          )}
          {filtered.map((j) => {
            const stale = isStale(j, now);
            const meta = STATUS_META[j.state];
            return (
              // biome-ignore lint/a11y/useSemanticElements: can't be a real <button> — Stop/Retry inside it are real buttons, and a button can't nest a button
              <div key={j.id} role="button" tabIndex={0} onClick={() => setSelected(j.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(j.id); } }}
                style={{ ...card, cursor: "pointer", padding: 12, display: "flex", flexDirection: "column", gap: 6,
                  borderColor: selected === j.id ? "var(--accent)" : "var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: stale ? "#E5A100" : meta.color, display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700 }}>
                    <Icon name={meta.icon} size={12} /> {stale ? "Stalled?" : meta.label}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 13.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titleFor(j)}</span>
                  {(j.state === "queued" || j.state === "running") && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); kill(j.id); }} style={{ ...btn, padding: "3px 8px", fontSize: 11 }}>Stop</button>
                  )}
                  {j.state === "failed" && j.failureKind !== "budget" && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); retry(j.id); }} style={{ ...btn, padding: "3px 8px", fontSize: 11 }}>Retry</button>
                  )}
                  {j.state === "failed" && j.failureKind === "budget" && (
                    <span style={{ ...btn, padding: "3px 8px", fontSize: 11, cursor: "default", color: "#E5A100", background: "transparent" }}>Budget stop</span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--muted)" }}>
                  <span>{when(j.createdAt)}</span>
                  <span>cost {cost(j)}</span>
                  {j.startedAt && <span>{elapsed((j.finishedAt || now) - j.startedAt)}</span>}
                </div>
                {j.state === "running" && j.steps.length > 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--accent)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Icon name="pulse" size={11} /> {j.steps[j.steps.length - 1].label}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ flex: "1 1 45%", borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 14 }}>
          {!selected || !detail ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: 20, textAlign: "center" }}>Select a task to see its log and status.</div>
          ) : (
            <TaskDetail job={detail.job} log={detail.log} onKill={() => kill(detail.job.id)} onRetry={() => retry(detail.job.id)} onRaiseBudget={(b) => raiseBudget(detail.job.id, b)} />
          )}
        </div>
      </div>

      {newOpen && <NewTaskSheet onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); refresh(); }} busy={busy} setBusy={setBusy} setErr={setErr} />}
      {playbooksOpen && <PlaybookSheet onClose={() => setPlaybooksOpen(false)} onRan={() => { setPlaybooksOpen(false); refresh(); }} setErr={setErr} />}
    </div>
  );
}

function TaskDetail({ job, log, onKill, onRetry, onRaiseBudget }: { job: Job; log: string[]; onKill: () => void; onRetry: () => void; onRaiseBudget: (budget: number) => void }) {
  const meta = STATUS_META[job.state];
  const isBudgetStop = job.state === "failed" && job.failureKind === "budget";
  const [newBudget, setNewBudget] = useState(() => String(Math.max(job.costTokens * 2, (job.costBudget || 0) * 2, 1000)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{titleFor(job)}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11.5 }}>
        <span style={{ color: meta.color, fontWeight: 700 }}><Icon name={meta.icon} size={11} /> {meta.label}</span>
        <span style={{ color: "var(--muted)" }}>kind: {job.kind}</span>
        <span style={{ color: "var(--muted)" }}>cost: {cost(job)}{job.tier ? ` (${job.tier})` : ""}</span>
        <span style={{ color: "var(--muted)" }}>created {when(job.createdAt)}</span>
        {job.finishedAt && <span style={{ color: "var(--muted)" }}>finished {when(job.finishedAt)}</span>}
      </div>
      {job.lastError && <div style={{ ...card, padding: 10, borderColor: isBudgetStop ? "#E5A100" : "#E5484D", color: isBudgetStop ? "#E5A100" : "#E5484D", fontSize: 12.5 }}>{job.lastError}</div>}
      {isBudgetStop ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>New budget (tokens)</span>
          <input type="number" min={job.costTokens + 1} value={newBudget} onChange={(e) => setNewBudget(e.target.value)}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 9px", color: "var(--text)", fontSize: 12.5, width: 100 }} />
          <button type="button" style={{ ...btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }}
            onClick={() => { const n = Number(newBudget); if (Number.isFinite(n) && n > 0) onRaiseBudget(n); }}>
            Raise budget &amp; resume
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          {(job.state === "queued" || job.state === "running") && <button type="button" style={btn} onClick={onKill}>Stop</button>}
          {job.state === "failed" && <button type="button" style={btn} onClick={onRetry}>Retry</button>}
        </div>
      )}
      {job.steps.length > 0 && <StepChecklist steps={job.steps} />}
      <div style={{ ...card, padding: 10, fontFamily: "ui-monospace, monospace", fontSize: 11.5, whiteSpace: "pre-wrap", maxHeight: 340, overflowY: "auto", color: "var(--text)" }}>
        {log.length ? log.join("\n") : <span style={{ color: "var(--muted)" }}>No log output yet.</span>}
      </div>
      {job.project && <TaskFiles slug={job.project} />}
    </div>
  );
}

// A5 — this task's files. Sourced straight from the project store (getYardProject,
// yardFileUrl) — no new storage layer, same data YardView's own file browser already
// reads. A job with no project (most job kinds today aren't project-scoped, or the
// project vanished) simply shows nothing here — not an error, just nothing to show.
const IMAGE_EXT = new Set(["svg", "png", "jpg", "jpeg", "gif", "webp", "ico"]);
const TEXT_EXT = new Set(["md", "txt", "html", "htm", "css", "js", "mjs", "json", "ts", "tsx", "jsx", "yml", "yaml"]);
function extOf(path: string): string { return (path.split(".").pop() || "").toLowerCase(); }
function fileBytes(n: number): string { return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`; }

function TaskFiles({ slug }: { slug: string }) {
  const [files, setFiles] = useState<{ path: string; bytes: number }[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const isDesktop = typeof window !== "undefined" && !!(window as any).samDesktop?.isNative;

  useEffect(() => {
    getYardProject(slug).then((r: any) => setFiles(r?.files || [])).catch(() => setFiles([]));
  }, [slug]);

  const preview = (path: string) => {
    if (open === path) { setOpen(null); setText(null); return; }
    setOpen(path); setText(null);
    if (TEXT_EXT.has(extOf(path))) {
      getYardProjectFile(slug, path).then((r: any) => setText(typeof r?.text === "string" ? r.text : "(couldn't read this file)")).catch(() => setText("(couldn't read this file)"));
    }
  };

  if (!files) return null;
  if (!files.length) return <div style={{ fontSize: 12, color: "var(--muted)" }}>No files in this project (yet).</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--muted)" }}>Files</div>
      {files.map((f) => {
        const ext = extOf(f.path);
        const previewable = IMAGE_EXT.has(ext) || TEXT_EXT.has(ext);
        return (
          <div key={f.path} style={{ ...card, padding: "8px 10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {previewable ? (
                // biome-ignore lint/a11y/useSemanticElements: can't be a real <button> — the download <a> next to it can't nest inside one
                <div role="button" tabIndex={0}
                  onClick={() => preview(f.path)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); preview(f.path); } }}
                  style={{ flex: 1, minWidth: 0, cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--text)" }}>
                  {f.path}
                </div>
              ) : (
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--text)" }}>
                  {f.path}
                </div>
              )}
              <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>{fileBytes(f.bytes)}</span>
              <a href={yardFileUrl(slug, f.path)} download={f.path.split("/").pop()} style={{ ...btn, padding: "3px 8px", fontSize: 11, textDecoration: "none" }}>
                <Icon name="download" size={11} />
              </a>
              {isDesktop && (
                <button type="button" style={{ ...btn, padding: "3px 8px", fontSize: 11 }}
                  onClick={() => (window as any).samDesktop.revealInFinder(`${slug}/${f.path}`)}>
                  <Icon name="folder" size={11} />
                </button>
              )}
            </div>
            {open === f.path && (
              <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                {IMAGE_EXT.has(ext) ? (
                  <img src={yardFileUrl(slug, f.path)} alt={f.path} style={{ maxWidth: "100%", borderRadius: "var(--radius-sm)" }} />
                ) : ext === "md" ? (
                  // Same rendering path chat text already uses (src/lib/md.ts) — the yard's
                  // own model-written output, not arbitrary third-party HTML.
                  <div style={{ fontSize: 12.5, color: "var(--text)" }} dangerouslySetInnerHTML={{ __html: renderMarkdown(text || "") }} />
                ) : (
                  <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, whiteSpace: "pre-wrap", maxHeight: 260, overflowY: "auto", color: "var(--text)" }}>
                    {text === null ? "Loading…" : text}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The live plan — steps the job itself declared as it ran (ctx.step, server/yard/worker.ts),
// never a model guessing after the fact. A job kind that never calls ctx.step has no steps
// at all; the caller only renders this when there's something real to show.
// A6 — the meter. Real token counts from server/yard/store.ts's meter() (queried over
// the WHOLE job table, not the capped recent list) and real provider-tier attribution
// (job.tier, set once per job at first ctx.spend(tokens, tier) — see worker.ts). No
// invented currency: a job kind that never spends against a model (project.create,
// checkpoint, restore) simply never tags a tier, and shows up as "unattributed", not
// silently folded into "free".
function TaskMeter({ meter }: { meter: { todayTokens: number; weekTokens: number; byTier: Record<string, number> } }) {
  const tiers = Object.entries(meter.byTier);
  const weekTotal = tiers.reduce((s, [, n]) => s + n, 0);
  const freeTokens = meter.byTier.free || 0;
  const freePct = weekTotal > 0 ? Math.round((freeTokens / weekTotal) * 100) : null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "7px 16px", borderBottom: "1px solid var(--border)", fontSize: 11.5, color: "var(--muted)" }}>
      <span><Icon name="chart" size={12} /> Today <strong style={{ color: "var(--text)" }}>{meter.todayTokens.toLocaleString()}</strong></span>
      <span>This week <strong style={{ color: "var(--text)" }}>{meter.weekTokens.toLocaleString()}</strong></span>
      {freePct !== null && <span>{freePct}% free tier this week</span>}
    </div>
  );
}

const STEP_META: Record<JobStep["state"], { icon: any; color: string }> = {
  running: { icon: "pulse", color: "var(--accent)" },
  done: { icon: "check", color: "#3FAE5C" },
  failed: { icon: "warn", color: "#E5484D" },
  stopped: { icon: "ban", color: "var(--muted)" },
};
function StepChecklist({ steps }: { steps: JobStep[] }) {
  return (
    <div style={{ ...card, padding: "6px 10px" }}>
      {steps.map((s, i) => {
        const m = STEP_META[s.state];
        return (
          <div key={`${s.at}-${s.label}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderTop: i > 0 ? "1px solid var(--border)" : undefined }}>
            <span style={{ color: m.color, flexShrink: 0, marginTop: 1 }}><Icon name={m.icon} size={13} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: s.state === "running" ? "var(--text)" : "var(--muted)", fontWeight: s.state === "running" ? 600 : 400 }}>{s.label}</div>
              {s.error && <div style={{ fontSize: 11, color: "#E5484D", marginTop: 2 }}>{s.error}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A8 — first-run onboarding. Three real actions, each already fully wired (nothing
// aspirational): build a project, save a playbook, or open the capability sheet built in
// A2. The third dispatches a window event rather than a prop — the "+" menu lives in
// App.tsx, a sibling this component has no direct handle to.
function FirstRunCards({ onNewTask, onPlaybooks }: { onNewTask: () => void; onPlaybooks: () => void }) {
  const cardStyle: React.CSSProperties = { ...card, padding: 20, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 6 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "20px 4px" }}>
      <div style={{ fontSize: 13, color: "var(--muted)", textAlign: "center" }}>Nothing has run yet. Three ways to start:</div>
      <button type="button" style={cardStyle} onClick={onNewTask}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: "var(--text)" }}><Icon name="grid" size={15} /> Build a project</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Say what it is, watch the checklist tick through, see it land.</span>
      </button>
      <button type="button" style={cardStyle} onClick={onPlaybooks}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: "var(--text)" }}><Icon name="book" size={15} /> Save a Playbook</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Turn a prompt you'd otherwise retype into a one-tap, parameterised job.</span>
      </button>
      <button type="button" style={cardStyle} onClick={() => window.dispatchEvent(new Event("sam:open-plus"))}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: "var(--text)" }}><Icon name="sliders" size={15} /> See what SAM can do</span>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>The "+" menu, grouped — capture, work, and system actions in one place.</span>
      </button>
    </div>
  );
}

function NewTaskSheet({ onClose, onCreated, busy, setBusy, setErr }: { onClose: () => void; onCreated: () => void; busy: boolean; setBusy: (b: boolean) => void; setErr: (s: string) => void }) {
  const [kind, setKind] = useState<"project.build" | "project.edit">("project.build");
  const [name, setName] = useState("");
  const [spec, setSpec] = useState("");
  const [slug, setSlug] = useState("");
  const [what, setWhat] = useState("");
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>([]);

  useEffect(() => { getYardProjects().then((r: any) => setProjects(r?.projects || [])).catch(() => { /* form still usable for "build new" without the list */ }); }, []);

  const submit = async () => {
    setErr("");
    setBusy(true);
    try {
      if (kind === "project.build") {
        if (!name.trim()) throw new Error("give the new project a name");
        await enqueueYardJob("project.build", { name: name.trim(), spec: spec.trim() || name.trim() });
      } else {
        if (!slug) throw new Error("pick a project to edit");
        if (!what.trim()) throw new Error("say what to change");
        await enqueueYardJob("project.edit", { slug, what: what.trim() });
      }
      onCreated();
    } catch (e: any) { setErr(e?.message || "couldn't start that task"); }
    finally { setBusy(false); }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click-outside close
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; click-outside close
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }} onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; stops backdrop-close propagation only */}
      <aside style={{ ...card, width: "min(440px,92vw)", padding: 20, display: "flex", flexDirection: "column", gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>New task</div>
        <div style={{ display: "flex", gap: 4 }} role="tablist">
          <button type="button" role="tab" aria-selected={kind === "project.build"} onClick={() => setKind("project.build")}
            style={{ ...btn, background: kind === "project.build" ? "var(--accent-soft)" : "var(--bg)" }}>Build new</button>
          <button type="button" role="tab" aria-selected={kind === "project.edit"} onClick={() => setKind("project.edit")}
            style={{ ...btn, background: kind === "project.edit" ? "var(--accent-soft)" : "var(--bg)" }}>Edit existing</button>
        </div>
        {kind === "project.build" ? (<>
          <input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", color: "var(--text)", fontSize: 13 }} />
          <textarea placeholder="What is it? (optional — falls back to the name)" value={spec} onChange={(e) => setSpec(e.target.value)} rows={3}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", color: "var(--text)", fontSize: 13, resize: "vertical" }} />
        </>) : (<>
          <select value={slug} onChange={(e) => setSlug(e.target.value)}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", color: "var(--text)", fontSize: 13 }}>
            <option value="">Pick a project…</option>
            {projects.map((p) => <option key={p.slug} value={p.slug}>{p.name}</option>)}
          </select>
          <textarea placeholder="What should change?" value={what} onChange={(e) => setWhat(e.target.value)} rows={3}
            style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", color: "var(--text)", fontSize: 13, resize: "vertical" }} />
        </>)}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" style={btn} onClick={onClose}>Cancel</button>
          <button type="button" disabled={busy} style={{ ...btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", opacity: busy ? 0.6 : 1 }} onClick={submit}>
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
      </aside>
    </div>
  );
}

// A4 — the Playbook. The operator's master prompts, saved, named, versioned, and
// parameterised — one tap enqueues a rendered version as a playbook.run yard job.
type Playbook = {
  id: string; name: string; template: string; params: string[];
  lastValues: Record<string, string>; version: number; createdAt: number; updatedAt: number;
};

const inputStyle: React.CSSProperties = { background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "8px 10px", color: "var(--text)", fontSize: 13 };

function PlaybookSheet({ onClose, onRan, setErr }: { onClose: () => void; onRan: () => void; setErr: (s: string) => void }) {
  const [playbooks, setPlaybooks] = useState<Playbook[] | null>(null);
  const [refused, setRefused] = useState(false);
  const [mode, setMode] = useState<"list" | "edit" | "run">("list");
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [running, setRunning] = useState<Playbook | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    // Same shape as the yard refresh above: /api/playbooks answers an untrusted browser with 403,
    // never with a `refused` field, so this sheet's own "pair this browser" state was unreachable
    // and a refusal read as an empty playbook list — "you have none" rather than "I can't see them".
    getPlaybooks().then((r: any) => { setRefused(false); setPlaybooks(r.playbooks || []); })
      .catch((e: any) => { if (e?.locked || e?.status === 401 || e?.status === 403) setRefused(true); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const startEdit = (pb?: Playbook) => { setEditingId(pb?.id); setName(pb?.name || ""); setTemplate(pb?.template || ""); setMode("edit"); };
  const save = async () => {
    setErr(""); setBusy(true);
    try { await savePlaybook({ id: editingId, name, template }); setMode("list"); load(); }
    catch (e: any) { setErr(e?.message || "couldn't save that playbook"); }
    finally { setBusy(false); }
  };
  const remove = async (pb: Playbook) => {
    setErr("");
    try { await deletePlaybook(pb.id); load(); }
    catch (e: any) { setErr(e?.message || "couldn't delete that playbook"); }
  };
  const doRun = async (pb: Playbook, vals: Record<string, string>) => {
    setErr(""); setBusy(true);
    try { await runPlaybook(pb.id, vals); onRan(); }
    catch (e: any) { setErr(e?.message || "couldn't start that playbook"); setBusy(false); }
  };
  const startRun = (pb: Playbook) => {
    if (!pb.params.length) { doRun(pb, {}); return; }
    setRunning(pb); setValues({ ...pb.lastValues }); setMode("run");
  };
  const onImportFile = async (file: File) => {
    setErr("");
    try { const text = await file.text(); await importPlaybook(text, file.name); load(); }
    catch (e: any) { setErr(e?.message || "couldn't import that file"); }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click-outside close
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; click-outside close
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 80 }} onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; stops backdrop-close propagation only */}
      <aside style={{ ...card, width: "min(520px,92vw)", maxHeight: "80vh", padding: 20, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {mode === "list" && (<>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)", flex: 1 }}>Playbooks</div>
            <input ref={fileRef} type="file" accept=".md,text/markdown" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportFile(f); e.target.value = ""; }} />
            <button type="button" style={btn} onClick={() => fileRef.current?.click()}><Icon name="download" size={12} /> Import .md</button>
            <button type="button" style={{ ...btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }} onClick={() => startEdit()}>
              <Icon name="plus" size={12} /> New
            </button>
          </div>
          {refused ? (
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>This device isn't paired yet — pair it to see and run playbooks.</div>
              <PairPrompt />
            </div>
          ) : !playbooks?.length ? (
            <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 24 }}>
              No playbooks yet. Import a .md brief, or write one from scratch.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {playbooks.map((pb) => (
                <div key={pb.id} style={{ ...card, padding: 10, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pb.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>v{pb.version}{pb.params.length ? ` · ${pb.params.join(", ")}` : ""}</div>
                  </div>
                  <button type="button" style={{ ...btn, padding: "4px 9px" }} onClick={() => startEdit(pb)}><Icon name="pencil" size={12} /></button>
                  <button type="button" style={{ ...btn, padding: "4px 9px" }} onClick={() => remove(pb)}><Icon name="trash" size={12} /></button>
                  <button type="button" style={{ ...btn, padding: "4px 9px", background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }} onClick={() => startRun(pb)}>Run</button>
                </div>
              ))}
            </div>
          )}
        </>)}

        {mode === "edit" && (<>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{editingId ? "Edit playbook" : "New playbook"}</div>
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          <textarea placeholder={"The prompt. Use {{name}} for anything you want filled in on run — e.g. {{project}}, {{repo}}, {{branch}}, {{target}}."}
            value={template} onChange={(e) => setTemplate(e.target.value)} rows={10}
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 12.5, resize: "vertical" }} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" style={btn} onClick={() => setMode("list")}>Cancel</button>
            <button type="button" disabled={busy || !name.trim() || !template.trim()} style={{ ...btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", opacity: busy ? 0.6 : 1 }} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </>)}

        {mode === "run" && running && (<>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Run “{running.name}”</div>
          {running.params.map((p) => (
            <label key={p} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
              {p}
              <input value={values[p] || ""} onChange={(e) => setValues((v) => ({ ...v, [p]: e.target.value }))} style={inputStyle} placeholder={running.lastValues[p] || `{{${p}}}`} />
            </label>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" style={btn} onClick={() => setMode("list")}>Cancel</button>
            <button type="button" disabled={busy} style={{ ...btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff", opacity: busy ? 0.6 : 1 }} onClick={() => doRun(running, values)}>
              {busy ? "Starting…" : "Run"}
            </button>
          </div>
        </>)}
      </aside>
    </div>
  );
}
