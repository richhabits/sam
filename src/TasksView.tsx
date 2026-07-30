import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getYard, getYardJob, enqueueYardJob, cancelYardJob, retryYardJob, getYardProjects } from "./lib/api";
import Icon from "./Icon";
import PairPrompt from "./PairPrompt";

// THE FACE, Tasks half — every yard job as a durable, revisitable thread, in the same
// app shell the Agent (chat) lives in. Read-only data comes straight from the job table
// (/api/yard, /api/yard/job/:id) — no new store, this is a rendering problem, not a
// build problem. Starting/stopping work still goes through the yard's own trust gate
// (loopback, or a paired device — see server/http-guards.ts).

type Job = {
  id: string; kind: string; payload: any;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  attempts: number; createdAt: number; startedAt: number | null; finishedAt: number | null;
  heartbeatAt: number | null; costTokens: number; costBudget: number | null;
  lastError: string | null; failureKind: string | null; cancelRequested: boolean;
  logPath: string | null; project: string | null;
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

export default function TasksView() {
  const [on, setOn] = useState<boolean | null>(null);
  const [refused, setRefused] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ job: Job; log: string[] } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(Date.now());
  const [newOpen, setNewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { document.title = "Tasks · SAM"; }, []);

  const refresh = useCallback(() => {
    getYard().then((r: any) => {
      setOn(!!r.on);
      setRefused(!!r.refused);
      setJobs(r.recent || []);
      setNow(Date.now());
    }).catch(() => { /* transient fetch failure — the next poll tries again */ });
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
        <button type="button" style={{ ...btn, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }} onClick={() => setNewOpen(true)}>
          <Icon name="plus" size={12} /> New task
        </button>
      </div>

      {err && <div style={{ margin: "10px 16px 0", color: "#E5484D", fontSize: 12.5 }}>{err}</div>}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: "1 1 55%", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {!filtered.length && (
            <div style={{ ...card, textAlign: "center", padding: 40, color: "var(--muted)", fontSize: 13.5 }}>
              {jobs.length ? "No tasks match that filter or search." : "Nothing has run yet — assign a task to get started."}
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
                  {j.state === "failed" && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); retry(j.id); }} style={{ ...btn, padding: "3px 8px", fontSize: 11 }}>Retry</button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "var(--muted)" }}>
                  <span>{when(j.createdAt)}</span>
                  <span>cost {cost(j)}</span>
                  {j.startedAt && <span>{elapsed((j.finishedAt || now) - j.startedAt)}</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ flex: "1 1 45%", borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 14 }}>
          {!selected || !detail ? (
            <div style={{ color: "var(--muted)", fontSize: 13, padding: 20, textAlign: "center" }}>Select a task to see its log and status.</div>
          ) : (
            <TaskDetail job={detail.job} log={detail.log} onKill={() => kill(detail.job.id)} onRetry={() => retry(detail.job.id)} />
          )}
        </div>
      </div>

      {newOpen && <NewTaskSheet onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); refresh(); }} busy={busy} setBusy={setBusy} setErr={setErr} />}
    </div>
  );
}

function TaskDetail({ job, log, onKill, onRetry }: { job: Job; log: string[]; onKill: () => void; onRetry: () => void }) {
  const meta = STATUS_META[job.state];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{titleFor(job)}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11.5 }}>
        <span style={{ color: meta.color, fontWeight: 700 }}><Icon name={meta.icon} size={11} /> {meta.label}</span>
        <span style={{ color: "var(--muted)" }}>kind: {job.kind}</span>
        <span style={{ color: "var(--muted)" }}>cost: {cost(job)}</span>
        <span style={{ color: "var(--muted)" }}>created {when(job.createdAt)}</span>
        {job.finishedAt && <span style={{ color: "var(--muted)" }}>finished {when(job.finishedAt)}</span>}
      </div>
      {job.lastError && <div style={{ ...card, padding: 10, borderColor: "#E5484D", color: "#E5484D", fontSize: 12.5 }}>{job.lastError}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        {(job.state === "queued" || job.state === "running") && <button type="button" style={btn} onClick={onKill}>Stop</button>}
        {job.state === "failed" && <button type="button" style={btn} onClick={onRetry}>Retry</button>}
      </div>
      <div style={{ ...card, padding: 10, fontFamily: "ui-monospace, monospace", fontSize: 11.5, whiteSpace: "pre-wrap", maxHeight: 340, overflowY: "auto", color: "var(--text)" }}>
        {log.length ? log.join("\n") : <span style={{ color: "var(--muted)" }}>No log output yet.</span>}
      </div>
    </div>
  );
}

// Minimal for A1: the two job kinds that already exist end-to-end (build a new project,
// edit an existing one). A generic "run this prompt" kind — what the Playbook (A4) needs
// to enqueue arbitrary work — doesn't exist server-side yet.
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
