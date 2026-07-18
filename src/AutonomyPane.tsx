import { useState, useEffect } from "react";
import { getConsent, setConsent, consentDisableAll, getSuggestions, getAutonomyLog, clearAutonomyLog } from "./lib/api";
import Icon, { type IconName } from "./Icon";
import { useEscape } from "./lib/useOverlay";

// "What can SAM do on its own?" — the trust contract. Every proactive behavior is OFF by default and
// individually toggleable. Below: the cards SAM would surface right now, and a log of everything it has
// done or suggested autonomously. Enabling a behavior is autonomy in scheduling, never in permissions —
// dangerous actions still always ask.
//
// Three sections used to stack into one long scroll (behaviors, then suggestions, then an unbounded
// log); they're tabs now, so each view is about a screen. The switch is the `.sw` from Settings — one
// switch shape across the app — and the log's emoji are stroke glyphs that take the theme's colours.

type Behavior = { id: string; label: string; detail: string; dangerousCapable: boolean; enabled: boolean };
type Card = { id: string; behavior: string; title: string; body: string; dangerous: boolean };
type LogEntry = { at: string; behavior: string; kind: "suggested" | "acted" | "blocked"; summary: string; tool?: string };

const KIND_ICON: Record<string, IconName> = { suggested: "sparkle", acted: "settings", blocked: "ban" };

export default function AutonomyPane({ onClose }: { onClose: () => void }) {
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tab, setTab] = useState<"behaviors" | "cards" | "log">("behaviors");
  useEscape(onClose);

  const load = () => {
    getConsent().then((d) => setBehaviors(d?.behaviors || [])).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
    getSuggestions().then((d) => setCards(d?.cards || [])).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
    getAutonomyLog().then((d) => setLog(d?.entries || [])).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: poll on mount; load is stable, cleaned up on unmount
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, []);

  const toggle = async (b: Behavior) => { await setConsent(b.id, !b.enabled); load(); };
  const pauseAll = async () => { await consentDisableAll(); load(); };
  const clearLog = async () => { await clearAutonomyLog(); load(); };

  const onCount = behaviors.filter((b) => b.enabled).length;
  const when = (iso: string) => { try { return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer autonomy" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title"><Icon name="sliders" size={19} /> What SAM can do on its own</div>
            <div className="drawer-sub">Off until you allow it. Dangerous actions always ask.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>

        <div className="pop-tabs">
          <button type="button" className={tab === "behaviors" ? "on" : ""} onClick={() => setTab("behaviors")}>Behaviors</button>
          <button type="button" className={tab === "cards" ? "on" : ""} onClick={() => setTab("cards")}>Suggestions{cards.length > 0 ? ` (${cards.length})` : ""}</button>
          <button type="button" className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>Log{log.length > 0 ? ` (${log.length})` : ""}</button>
        </div>

        {tab === "behaviors" && (
          <>
            <div className="au-section-row">
              <span className="au-section-label">{onCount === 0 ? "All off" : `${onCount} on`}</span>
              {onCount > 0 && <button type="button" className="au-pause" onClick={pauseAll}><Icon name="pause" size={13} /> Pause all</button>}
            </div>
            <div className="au-behaviors">
              {behaviors.map((b) => (
                <button type="button" key={b.id} className={"au-behavior" + (b.enabled ? " on" : "")} onClick={() => toggle(b)} aria-pressed={b.enabled}>
                  <span className={"sw" + (b.enabled ? " on" : "")} aria-hidden="true"><i /></span>
                  <span className="au-b-text">
                    <span className="au-b-label">{b.label} {b.dangerousCapable && <span className="au-danger-tag" title="Can propose a dangerous action — which still pauses for your OK">gated</span>}</span>
                    <span className="au-b-detail">{b.detail}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === "cards" && (
          <div className="au-cards">
            {cards.length === 0 && <div className="drawer-empty">Nothing to suggest right now.</div>}
            {cards.map((c) => (
              <div key={c.id} className="au-card">
                <div className="au-card-title">{c.title} {c.dangerous && <span className="au-danger-tag">asks first</span>}</div>
                <div className="au-card-body">{c.body}</div>
              </div>
            ))}
          </div>
        )}

        {tab === "log" && (
          <>
            <div className="au-section-row">
              <span className="au-section-label">On this device only</span>
              {log.length > 0 && <button type="button" className="au-pause" onClick={clearLog}><Icon name="trash" size={13} /> Clear</button>}
            </div>
            <div className="au-log">
              {log.length === 0 && <div className="drawer-empty">Nothing yet. Anything SAM does on its own is recorded here.</div>}
              {log.map((e, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only autonomy log; order is stable
                <div key={i} className={"au-log-row " + e.kind}>
                  <span className="au-log-icon"><Icon name={KIND_ICON[e.kind] || "clock"} size={15} /></span>
                  <span className="au-log-summary">{e.summary}{e.tool && <span className="au-log-tool"> · {e.tool}</span>}</span>
                  <span className="au-log-when">{when(e.at)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
