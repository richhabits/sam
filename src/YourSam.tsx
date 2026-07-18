import { useState, useEffect } from "react";
import { getAnalytics, setTelemetry, getTelemetryPreview } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 📈 "Your SAM" — the user's own usage, computed 100% on-device. The point: make the value of staying
// obvious (SAM has learned N preferences, saved you ~X hours) AND make the privacy stance loud
// (0 data left your device). Also hosts the neutral, opt-in anonymous-telemetry choice with a live
// preview of the exact payload — no dark patterns.

type Stats = {
  retentionDays: number; activeDays: number; tasks: number; totalToolUses: number;
  topTools: { name: string; count: number }[]; workflowRuns: number; cacheHits: number;
  hoursSaved: number; activated: boolean; dataLeftDevice: number; preferencesLearned: number;
  telemetry: { enabled: boolean; decided: boolean };
};

export default function YourSam({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Stats | null>(null);
  const [preview, setPreview] = useState<any>(undefined);
  useEscape(onClose);

  const load = () => getAnalytics().then(setS).catch(() => {});
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once on mount
  useEffect(() => { load(); }, []);

  const toggleTelemetry = async () => { await setTelemetry(!s?.telemetry.enabled); load(); };
  const showPreview = async () => { const d = await getTelemetryPreview(); setPreview(d?.payload ?? null); };

  const Stat = ({ big, label }: { big: string; label: string }) => (
    <div className="ys-stat"><div className="ys-stat-big">{big}</div><div className="ys-stat-label">{label}</div></div>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer yoursam" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">📈 Your SAM</div>
            <div className="drawer-sub">Your usage, computed <b>on your device</b>. This is a feature for you — not surveillance of you.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!s ? <div className="drawer-empty">Loading…</div> : (
          <>
            <div className="ys-hero">
              <span className="ys-hero-lock">🔒</span>
              <span><b>{s.dataLeftDevice} bytes</b> of your data have left this device.<br /><span className="ys-hero-sub">Everything below was computed locally.</span></span>
            </div>

            <div className="ys-grid">
              <Stat big={`${s.retentionDays}`} label={`day${s.retentionDays === 1 ? "" : "s"} with SAM`} />
              <Stat big={`${s.tasks}`} label="tasks run" />
              <Stat big={`~${s.hoursSaved}h`} label="saved (est.)" />
              <Stat big={`${s.preferencesLearned}`} label="things learned about you" />
              <Stat big={`${s.workflowRuns}`} label="workflow runs" />
              <Stat big={`${s.cacheHits}`} label="instant cache hits" />
            </div>

            {s.topTools.length > 0 && (
              <>
                <div className="au-section-label">What you use most</div>
                <div className="ys-tools">
                  {s.topTools.map((t) => (
                    <div key={t.name} className="ys-tool"><span className="ys-tool-name">{t.name}</span><span className="ys-tool-count">{t.count}</span></div>
                  ))}
                </div>
              </>
            )}

            <div className="au-section-label" style={{ marginTop: 20 }}>Help SAM survive (optional)</div>
            <div className="ys-tel">
              <button type="button" className={"au-behavior" + (s.telemetry.enabled ? " on" : "")} onClick={toggleTelemetry}>
                <span className={"au-switch" + (s.telemetry.enabled ? " on" : "")} aria-hidden><span className="au-knob" /></span>
                <span className="au-b-text">
                  <span className="au-b-label">Share anonymous usage</span>
                  <span className="au-b-detail">Off by default. If on, SAM sends an <b>anonymous, aggregate</b> ping (version, OS, active-today, feature counts) so the maker can see if people stay. <b>Never</b> your content, files, prompts or name. This is how a free tool learns it's worth continuing.</span>
                </span>
              </button>
              <button type="button" className="ys-preview-btn" onClick={showPreview}>See exactly what would be sent →</button>
              {preview !== undefined && (
                <pre className="ys-preview">{preview === null ? "// telemetry is off — nothing is sent" : JSON.stringify(preview, null, 2)}</pre>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
