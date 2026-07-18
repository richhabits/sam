import { useState, useEffect } from "react";
import { getDoctor } from "./lib/api";
import Icon, { type IconName } from "./Icon";
import { useEscape } from "./lib/useOverlay";

// "SAM isn't working" — self-heal. Runs the common-failure checks and tells the user the exact fix,
// so a stuck user resolves it themselves instead of opening an issue.
//
// Every check used to print its label, its detail and its fix, so a healthy machine — where every
// line says some variant of "fine" — was the longest scroll of all. Passing checks collapse to one
// row with a one-word state; anything that warns or fails opens itself, because that's what you came
// to read. The ✅/⚠️/❌ traffic lights are stroke glyphs now, tinted by the same status colours the
// left border already used.

type Check = { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };
type Report = { healthy: boolean; summary: string; checks: Check[] };
const ICON: Record<Check["status"], IconName> = { ok: "check", warn: "warn", fail: "ban" };
const WORD: Record<Check["status"], string> = { ok: "OK", warn: "Check", fail: "Failed" };

export default function DoctorPane({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEscape(onClose);

  const run = () => {
    setLoading(true);
    getDoctor()
      .then((d: Report) => {
        setR(d);
        // Anything not OK opens itself — the detail and fix are the reason you opened this pane.
        setOpen(Object.fromEntries((d?.checks || []).filter((c) => c.status !== "ok").map((c) => [c.id, true])));
      })
      .catch(() => {/* best-effort — nothing user-visible depends on this succeeding */})
      .finally(() => setLoading(false));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: run checks once on mount
  useEffect(() => { run(); }, []);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer doctor" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title"><Icon name="pulse" size={19} /> Is SAM working?</div>
            <div className="drawer-sub">{loading ? "Checking the usual suspects…" : (r?.summary || "")}</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>

        {r && (
          <div className="dr-checks">
            {r.checks.map((c) => {
              const isOpen = !!open[c.id];
              return (
                <div key={c.id} className={"dr-check " + c.status + (isOpen ? " open" : "")}>
                  <button
                    type="button"
                    className="dr-check-top"
                    onClick={() => setOpen((m) => ({ ...m, [c.id]: !m[c.id] }))}
                    aria-expanded={isOpen}
                  >
                    <span className="dr-icon"><Icon name={ICON[c.status]} size={16} /></span>
                    <span className="dr-label">{c.label}</span>
                    <span className="dr-state">{WORD[c.status]}</span>
                    <span className={"admin-chev" + (isOpen ? " open" : "")} aria-hidden="true">›</span>
                  </button>
                  {isOpen && (
                    <>
                      <div className="dr-detail">{c.detail}</div>
                      {c.fix && <div className="dr-fix"><b>Fix:</b> {c.fix}</div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <button type="button" className="dr-rerun" onClick={run} disabled={loading}>
          {loading ? "Checking…" : <><Icon name="refresh" size={14} /> Re-run checks</>}
        </button>
        <a className="dr-more" href="https://github.com/richhabits/sam/blob/main/docs/TROUBLESHOOTING.md" target="_blank" rel="noopener noreferrer">Full troubleshooting guide →</a>
      </aside>
    </div>
  );
}
