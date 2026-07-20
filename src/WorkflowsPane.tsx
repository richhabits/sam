import { useState, useEffect } from "react";
import { getWorkflows, installStarterWorkflows, runWorkflowApi, deleteWorkflowApi, getRoutines, bindRoutine, unbindRoutine } from "./lib/api";
import Icon from "./Icon";
import { useEscape } from "./lib/useOverlay";

// Workflows — named, saved, repeatable sequences of steps. A run does all the safe prep, then PAUSES
// at any dangerous step for your OK — it never sends, deletes or pushes unattended.
//
// Every card used to render its description, all its steps and its last run at once: six starters made
// six screens of scroll. Cards are now the same disclosure row as the API-keys drawer — name, step
// count, state — and you open the one you're about to run.

type Step = { id: string; kind: string; label: string; tool?: string };
type Run = { at: string; status: "done" | "paused" | "error"; results: { label: string; output: string }[]; pausedAtStep?: string; note?: string };
type Workflow = { id: string; name: string; description: string; steps: Step[]; dangerousSteps: string[]; runs: Run[] };

export default function WorkflowsPane({ onClose }: { onClose: () => void }) {
  const [flows, setFlows] = useState<Workflow[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [open, setOpen] = useState<string>("");
  const [lastRun, setLastRun] = useState<Record<string, Run>>({});
  const [phrases, setPhrases] = useState<Record<string, string>>({});   // workflowId → bound phrase (first)
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEscape(onClose);

  const load = () => getWorkflows().then((d) => setFlows(d?.workflows || [])).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
  const loadRoutines = () => getRoutines().then((d) => {
    const m: Record<string, string> = {};
    for (const r of d?.routines || []) m[r.workflowId] = (r.phrases || [])[0] || "";
    setPhrases(m);
  }).catch(() => {/* routines are optional — a failure just leaves the binders empty */});
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => { load(); loadRoutines(); }, []);

  const bind = async (id: string) => {
    const p = (draft[id] || "").trim();
    if (!p) return;
    await bindRoutine(id, [p]).catch(() => undefined);
    setDraft((d) => ({ ...d, [id]: "" }));
    loadRoutines();
  };
  const unbind = async (id: string) => { await unbindRoutine(id).catch(() => undefined); loadRoutines(); };

  const install = async () => { setBusy("install"); await installStarterWorkflows(); await load(); setBusy(""); };
  const run = async (id: string) => { setBusy(id); const d = await runWorkflowApi(id); if (d?.run) setLastRun((m) => ({ ...m, [id]: d.run })); await load(); setBusy(""); };
  const del = async (id: string) => { await deleteWorkflowApi(id); load(); };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer workflows" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title"><Icon name="link" size={19} /> Workflows</div>
            <div className="drawer-sub">Saved multi-step sequences. A run pauses at any dangerous step for your OK.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>

        {flows.length === 0 && (
          <div className="wf-empty">
            <div className="drawer-empty">No workflows yet. Install the 6 starters to see what SAM can chain — inbox triage, weekly review, research digest, and more.</div>
            <button type="button" className="wf-install" onClick={install} disabled={busy === "install"}>
              {busy === "install" ? "Installing…" : <><Icon name="sparkle" size={15} /> Install 6 starter workflows</>}
            </button>
          </div>
        )}

        <div className="wf-list">
          {flows.map((w) => {
            const lastR = lastRun[w.id] || w.runs?.[0];
            const isOpen = open === w.id;
            const gated = w.dangerousSteps?.length > 0;
            return (
              <div key={w.id} className={"wf-card" + (isOpen ? " open" : "")}>
                <div className="wf-card-head">
                  <button type="button" className="admin-rowhead wf-head" onClick={() => setOpen((v) => (v === w.id ? "" : w.id))} aria-expanded={isOpen}>
                    <span className="admin-name">{w.name}</span>
                    <span className="admin-keys">{gated ? "Asks" : `${w.steps.length} steps`}</span>
                    <span className={"admin-chev" + (isOpen ? " open" : "")} aria-hidden="true">›</span>
                  </button>
                  <div className="wf-actions">
                    <button type="button" className="wf-run" onClick={() => run(w.id)} disabled={busy === w.id} title={`Run ${w.name}`}>
                      {busy === w.id ? "Running…" : <><Icon name="play" size={13} /> Run</>}
                    </button>
                    <button type="button" className="wf-del" onClick={() => del(w.id)} title="Delete" aria-label={`Delete ${w.name}`}><Icon name="trash" size={15} /></button>
                  </div>
                </div>

                {isOpen && (
                  <div className="wf-body">
                    <div className="wf-desc">{w.description}</div>
                    <div className="wf-steps">
                      {w.steps.map((s, i) => {
                        const danger = w.dangerousSteps?.includes(s.id);
                        return (
                          <span key={s.id} className={"wf-step" + (danger ? " danger" : "")}>
                            {i + 1}. {s.label}{danger && <Icon name="lock" size={11} />}
                          </span>
                        );
                      })}
                    </div>
                    {/* Routine: bind a phrase so saying/typing it runs this workflow ahead of the brain */}
                    <div className="wf-routine">
                      {phrases[w.id]
                        ? <div className="wf-routine-on"><Icon name="voice" size={13} /> Say <b>“{phrases[w.id]}”</b> to run this <button type="button" className="wf-routine-clear" onClick={() => unbind(w.id)}>clear</button></div>
                        : <div className="wf-routine-set">
                            <Icon name="voice" size={13} />
                            <input value={draft[w.id] || ""} onChange={(e) => setDraft((d) => ({ ...d, [w.id]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") bind(w.id); }} placeholder="say “good morning” to run this…" aria-label="Routine phrase" />
                            <button type="button" onClick={() => bind(w.id)} disabled={!(draft[w.id] || "").trim()}>Bind</button>
                          </div>}
                    </div>
                  </div>
                )}

                {lastR && (
                  <div className={"wf-run-result " + lastR.status}>
                    {lastR.status === "paused" ? <><Icon name="pause" size={13} /> {lastR.note}</>
                      : lastR.status === "done" ? <><Icon name="check" size={13} /> Completed {lastR.results.length} step{lastR.results.length === 1 ? "" : "s"}</>
                      : <><Icon name="warn" size={13} /> {lastR.note || "error"}</>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
