import { useState, useEffect } from "react";
import { getPreferences, forgetPreference, resetPreferences, setConsent } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 🧠 "What SAM has learned about you" — the privacy counterpart to the consent pane. Everything here is
// stored ONLY on this device and is never sent to any AI provider or gateway. You can delete any item or
// reset everything. Learning is off unless you turn it on.

type Pref = { key: string; value: string; confidence: number; count: number; updatedAt: string };

export default function LearnedPane({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<Pref[]>([]);
  const [learning, setLearning] = useState(false);
  useEscape(onClose);

  const load = () => getPreferences().then((d) => { setPrefs(d?.preferences || []); setLearning(!!d?.learning); }).catch(() => {});
  useEffect(() => { load(); }, []);

  const forget = async (key: string) => { await forgetPreference(key); load(); };
  const resetAll = async () => { await resetPreferences(); load(); };
  const toggleLearning = async () => { await setConsent("learn-preferences", !learning); load(); };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer learned" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">🧠 What SAM has learned about you</div>
            <div className="drawer-sub"><span className="learned-lock">🔒 On-device only</span> — nothing here is ever sent to an AI provider or gateway. Delete anything, any time.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="learned-toggle-row">
          <button type="button" className={"au-behavior" + (learning ? " on" : "")} onClick={toggleLearning}>
            <span className={"au-switch" + (learning ? " on" : "")} aria-hidden><span className="au-knob" /></span>
            <span className="au-b-text">
              <span className="au-b-label">Let SAM learn my preferences</span>
              <span className="au-b-detail">Notice durable patterns (wording, preferred brains, formats) and adapt — 100% locally.</span>
            </span>
          </button>
        </div>

        <div className="au-section-row">
          <span className="au-section-label">{prefs.length} thing{prefs.length === 1 ? "" : "s"} learned</span>
          {prefs.length > 0 && <button type="button" className="au-pause" onClick={resetAll}>Reset everything</button>}
        </div>

        <div className="learned-list">
          {prefs.length === 0 && <div className="drawer-empty">{learning ? "Nothing learned yet — SAM will pick up your habits as you work." : "Learning is off. Turn it on above and SAM will start noticing your preferences (still on-device only)."}</div>}
          {prefs.map((p) => (
            <div key={p.key} className="learned-row">
              <div className="learned-main">
                <span className="learned-key">{p.key}</span>
                <span className="learned-value">{p.value}</span>
              </div>
              <div className="learned-meta">
                <span className="learned-conf" title={`seen ${p.count}×`}>
                  <span className="learned-conf-bar" style={{ width: `${Math.round(p.confidence * 100)}%` }} />
                </span>
                <button type="button" className="learned-forget" onClick={() => forget(p.key)} title="Forget this">✕</button>
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
