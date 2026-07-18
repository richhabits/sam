import { useState, useEffect } from "react";
import { getConsent, setConsent, consentDisableAll, getSuggestions, getAutonomyLog, clearAutonomyLog } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 🕹️ "What can SAM do on its own?" — the trust contract. Every proactive behavior is OFF by default and
// individually toggleable. Below: the cards SAM would surface right now, and a log of everything it has
// done or suggested autonomously. Enabling a behavior is autonomy in scheduling, never in permissions —
// dangerous actions still always ask.

type Behavior = { id: string; label: string; detail: string; dangerousCapable: boolean; enabled: boolean };
type Card = { id: string; behavior: string; title: string; body: string; dangerous: boolean };
type LogEntry = { at: string; behavior: string; kind: "suggested" | "acted" | "blocked"; summary: string; tool?: string };

const KIND_ICON: Record<string, string> = { suggested: "💡", acted: "⚙️", blocked: "🛑" };

export default function AutonomyPane({ onClose }: { onClose: () => void }) {
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  useEscape(onClose);

  const load = () => {
    getConsent().then((d) => setBehaviors(d?.behaviors || [])).catch(() => {});
    getSuggestions().then((d) => setCards(d?.cards || [])).catch(() => {});
    getAutonomyLog().then((d) => setLog(d?.entries || [])).catch(() => {});
  };
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

  const toggle = async (b: Behavior) => { await setConsent(b.id, !b.enabled); load(); };
  const pauseAll = async () => { await consentDisableAll(); load(); };
  const clearLog = async () => { await clearAutonomyLog(); load(); };

  const anyOn = behaviors.some((b) => b.enabled);
  const when = (iso: string) => { try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer autonomy" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">🕹️ What can SAM do on its own?</div>
            <div className="drawer-sub">Everything's off until you allow it. Enabling a behavior lets SAM speak up — it never lets SAM run anything dangerous unattended.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="au-section-row">
          <span className="au-section-label">Autonomous behaviors</span>
          {anyOn && <button type="button" className="au-pause" onClick={pauseAll}>⏸ Pause all</button>}
        </div>

        <div className="au-behaviors">
          {behaviors.map((b) => (
            <button type="button" key={b.id} className={"au-behavior" + (b.enabled ? " on" : "")} onClick={() => toggle(b)}>
              <span className={"au-switch" + (b.enabled ? " on" : "")} aria-hidden><span className="au-knob" /></span>
              <span className="au-b-text">
                <span className="au-b-label">{b.label} {b.dangerousCapable && <span className="au-danger-tag" title="Can propose a dangerous action — which still pauses for your OK">gated</span>}</span>
                <span className="au-b-detail">{b.detail}</span>
              </span>
            </button>
          ))}
        </div>

        {cards.length > 0 && (
          <>
            <div className="au-section-label">Suggestions right now</div>
            <div className="au-cards">
              {cards.map((c) => (
                <div key={c.id} className="au-card">
                  <div className="au-card-title">{c.title} {c.dangerous && <span className="au-danger-tag">asks first</span>}</div>
                  <div className="au-card-body">{c.body}</div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="au-section-row">
          <span className="au-section-label">Autonomy log</span>
          {log.length > 0 && <button type="button" className="au-pause" onClick={clearLog}>Clear</button>}
        </div>
        <div className="au-log">
          {log.length === 0 && <div className="drawer-empty">Nothing yet. When SAM acts or suggests on its own, it's recorded here — and nothing is ever uploaded.</div>}
          {log.map((e, i) => (
            <div key={i} className={"au-log-row " + e.kind}>
              <span className="au-log-icon">{KIND_ICON[e.kind] || "•"}</span>
              <span className="au-log-summary">{e.summary}{e.tool && <span className="au-log-tool"> · {e.tool}</span>}</span>
              <span className="au-log-when">{when(e.at)}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
