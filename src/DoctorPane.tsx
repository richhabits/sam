import { useState, useEffect } from "react";
import { getDoctor } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 🩺 "SAM isn't working" — self-heal. Runs the common-failure checks and tells the user the exact fix,
// so a stuck user resolves it themselves instead of opening an issue.

type Check = { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };
type Report = { healthy: boolean; summary: string; checks: Check[] };
const ICON = { ok: "✅", warn: "⚠️", fail: "❌" } as const;

export default function DoctorPane({ onClose }: { onClose: () => void }) {
  const [r, setR] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  useEscape(onClose);

  const run = () => { setLoading(true); getDoctor().then(setR).catch(() => {}).finally(() => setLoading(false)); };
  useEffect(() => { run(); }, []);

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer doctor" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">🩺 Is SAM working?</div>
            <div className="drawer-sub">{loading ? "Checking the usual suspects…" : (r?.summary || "")}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {r && (
          <div className="dr-checks">
            {r.checks.map((c) => (
              <div key={c.id} className={"dr-check " + c.status}>
                <div className="dr-check-top">
                  <span className="dr-icon">{ICON[c.status]}</span>
                  <span className="dr-label">{c.label}</span>
                </div>
                <div className="dr-detail">{c.detail}</div>
                {c.fix && <div className="dr-fix"><b>Fix:</b> {c.fix}</div>}
              </div>
            ))}
          </div>
        )}

        <button className="dr-rerun" onClick={run} disabled={loading}>{loading ? "Checking…" : "↻ Re-run checks"}</button>
        <a className="dr-more" href="https://github.com/richhabits/sam/blob/main/docs/TROUBLESHOOTING.md" target="_blank" rel="noopener noreferrer">Full troubleshooting guide →</a>
      </aside>
    </div>
  );
}
