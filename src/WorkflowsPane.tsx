import { useState, useEffect } from "react";
import { getWorkflows, installStarterWorkflows, runWorkflowApi, deleteWorkflowApi } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 🔗 Workflows — named, saved, repeatable sequences of steps. A run does all the safe prep, then PAUSES
// at any dangerous step for your OK — it never sends, deletes or pushes unattended.

type Step = { id: string; kind: string; label: string; tool?: string };
type Run = { at: string; status: "done" | "paused" | "error"; results: { label: string; output: string }[]; pausedAtStep?: string; note?: string };
type Workflow = { id: string; name: string; description: string; steps: Step[]; dangerousSteps: string[]; runs: Run[] };

export default function WorkflowsPane({ onClose }: { onClose: () => void }) {
  const [flows, setFlows] = useState<Workflow[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [lastRun, setLastRun] = useState<Record<string, Run>>({});
  useEscape(onClose);

  const load = () => getWorkflows().then((d) => setFlows(d?.workflows || [])).catch(() => {});
  useEffect(() => { load(); }, []);

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
            <div className="drawer-title">🔗 Workflows</div>
            <div className="drawer-sub">Saved multi-step sequences. A run pauses at any dangerous step for your OK — nothing risky runs on its own.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {flows.length === 0 && (
          <div className="wf-empty">
            <div className="drawer-empty">No workflows yet. Install the 6 starters to see what SAM can chain — inbox triage, weekly review, research digest, and more.</div>
            <button type="button" className="wf-install" onClick={install} disabled={busy === "install"}>{busy === "install" ? "Installing…" : "✨ Install 6 starter workflows"}</button>
          </div>
        )}

        <div className="wf-list">
          {flows.map((w) => {
            const lastR = lastRun[w.id] || w.runs?.[0];
            return (
              <div key={w.id} className="wf-card">
                <div className="wf-card-head">
                  <div className="wf-name">{w.name}{w.dangerousSteps?.length > 0 && <span className="au-danger-tag" title="Has a dangerous step — the run pauses there for your OK">pauses to ask</span>}</div>
                  <div className="wf-actions">
                    <button type="button" className="wf-run" onClick={() => run(w.id)} disabled={busy === w.id}>{busy === w.id ? "Running…" : "▶ Run"}</button>
                    <button type="button" className="wf-del" onClick={() => del(w.id)} title="Delete">🗑</button>
                  </div>
                </div>
                <div className="wf-desc">{w.description}</div>
                <div className="wf-steps">
                  {w.steps.map((s, i) => (
                    <span key={s.id} className={"wf-step" + (w.dangerousSteps?.includes(s.id) ? " danger" : "")}>
                      {i + 1}. {s.label}{w.dangerousSteps?.includes(s.id) && " 🔒"}
                    </span>
                  ))}
                </div>
                {lastR && (
                  <div className={"wf-run-result " + lastR.status}>
                    {lastR.status === "paused" ? `⏸ ${lastR.note}` : lastR.status === "done" ? `✓ Completed ${lastR.results.length} step${lastR.results.length === 1 ? "" : "s"}` : `⚠ ${lastR.note || "error"}`}
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
