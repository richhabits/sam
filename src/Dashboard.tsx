import { useState, useEffect } from "react";
import { getStatus, getLog, getSecurity, getSwarms, approveSwarmAgent, type Swarm, getSchedules, toggleSchedule, removeSchedule, type Schedule, getPeople } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// SAM control centre — one glance at everything: brains, tools, memory, activity.
const PROVIDER_LABEL: Record<string, string> = {
  cerebras: "Cerebras", groq: "Groq", nvidia: "NVIDIA", mistral: "Mistral",
  github: "GitHub Models", gemini: "Gemini", openrouter: "OpenRouter",
  anthropic: "Claude", openai: "OpenAI",
};

export default function Dashboard({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<any>(null);
  const [log, setLog] = useState<{ time: string; msg: string }[]>([]);
  const [sec, setSec] = useState<any>(null);
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  useEscape(onClose);

  useEffect(() => {
    const load = () => {
      getStatus().then(setS).catch(() => {});
      getLog().then((l) => setLog(l.slice(-8).reverse())).catch(() => {});
      getSecurity().then((d) => setSec(d.status)).catch(() => {});
      getSwarms().then(setSwarms).catch(() => {});
      getPeople().then((p) => setPeople(Array.isArray(p) ? p : [])).catch(() => {});
      getSchedules().then(setSchedules).catch(() => {});
    };
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  const providers = s?.models?.providers || [];
  const freeLive = providers.filter((p: any) => p.tier === "free" && p.keys > 0);
  const freeTotal = providers.filter((p: any) => p.tier === "free").length;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer dash" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">SAM · Control Centre</div>
            <div className="drawer-sub">Everything SAM is running, at a glance.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!s ? <div className="dash-empty">Connecting to SAM…</div> : (
          <>
            {/* headline stats */}
            <div className="dash-grid">
              <div className="dash-stat"><span className="dash-num">{freeLive.length}</span><span className="dash-lbl">free brains live</span></div>
              <div className="dash-stat"><span className="dash-num">{s.tools}</span><span className="dash-lbl">tools</span></div>
              <div className="dash-stat"><span className="dash-num">{s.skills}</span><span className="dash-lbl">skills</span></div>
              <div className="dash-stat"><span className="dash-num">{s.memory?.count ?? 0}</span><span className="dash-lbl">things remembered</span></div>
              <div className="dash-stat"><span className="dash-num">{s.projects}</span><span className="dash-lbl">brands</span></div>
              <div className="dash-stat"><span className="dash-num">{s.voice?.elevenlabs ? "ON" : "free"}</span><span className="dash-lbl">voice</span></div>
            </div>

            {/* brains */}
            <div className="dash-sec">AI brains ({freeLive.length}/{freeTotal} free lanes ready)</div>
            <div className="dash-lanes">
              {providers.map((p: any) => (
                <div key={p.id} className={`dash-lane ${p.keys > 0 ? "on" : ""}`}>
                  <span className={`dash-dot ${p.keys > 0 ? "live" : ""}`} />
                  <span className="dash-lane-name">{PROVIDER_LABEL[p.id] || p.id}</span>
                  <span className="dash-lane-tier">{p.tier}</span>
                  <span className="dash-lane-keys">{p.keys > 0 ? `${p.keys} key${p.keys > 1 ? "s" : ""}` : "—"}</span>
                </div>
              ))}
            </div>

            {/* security watchdog */}
            <div className="dash-sec">🛡️ Security</div>
            <div className={`dash-security ${sec && !sec.clear ? "flagged" : "clear"}`}>
              <span className="dash-shield">{sec && !sec.clear ? "⚠️" : "🛡️"}</span>
              <span>{sec ? sec.headline : "Checking…"}</span>
            </div>

            {/* swarm monitor */}
            <div className="dash-sec">🐝 Swarms ({swarms.filter(sw => sw.status === "running" || sw.status === "paused" || sw.status === "planning").length} active)</div>
            {swarms.length === 0 ? <div className="dash-empty">No swarms yet — use /swarm &lt;goal&gt; to launch one.</div> : (
              <div className="dash-lanes">
                {swarms.slice(-6).reverse().map((sw) => (
                  <div key={sw.id} className="dash-lane on" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600 }}>{sw.goal.slice(0, 60)}{sw.goal.length > 60 ? "…" : ""}</span>
                      <span className={`dash-lane-tier`} style={{ background: sw.status === "done" ? "var(--c-ok)" : sw.status === "error" ? "var(--c-err)" : sw.status === "paused" ? "#f59e0b" : "var(--c-blue)", color: "#fff", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{sw.status}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                      {sw.agents.map((a) => (
                        <div key={a.id} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, background: a.status === "paused" ? "rgba(245,158,11,0.15)" : a.status === "done" ? "rgba(34,197,94,0.1)" : a.status === "error" ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 2, minWidth: 120 }}>
                          <span>{a.emoji} {a.name} <span style={{ opacity: 0.5 }}>{a.status}</span></span>
                          {a.status === "paused" && a.pendingTool && (
                            <div style={{ marginTop: 4 }}>
                              <div style={{ fontSize: 11, color: "var(--c-err)", fontWeight: 500 }}>⏸ {a.pendingTool}</div>
                              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                                <button type="button" className="mini" onClick={() => approveSwarmAgent(sw.id, a.id, true).then(() => getSwarms().then(setSwarms))}>Approve</button>
                                <button type="button" className="mini" style={{ opacity: 0.6 }} onClick={() => approveSwarmAgent(sw.id, a.id, false).then(() => getSwarms().then(setSwarms))}>Reject</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {sw.synthesis && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 6 }}>{sw.synthesis.slice(0, 200)}{sw.synthesis.length > 200 ? "…" : ""}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* schedules monitor */}
            <div className="dash-sec">⏰ Scheduled Tasks ({schedules.filter(s => s.enabled).length} active)</div>
            {schedules.length === 0 ? <div className="dash-empty">No scheduled tasks. Use /schedule to add one.</div> : (
              <div className="dash-lanes">
                {schedules.map((s) => (
                  <div key={s.id} className={`dash-lane ${s.enabled ? "on" : ""}`} style={{ flexDirection: "column", alignItems: "stretch", gap: 6, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600 }}>{s.command.slice(0, 60)}{s.command.length > 60 ? "…" : ""}</span>
                      <span className="dash-lane-tier">{s.cron}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, opacity: 0.7 }}>
                      <span>Ran {s.runCount} times {s.lastRun && `(last: ${new Date(s.lastRun).toLocaleTimeString()})`}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="mini" onClick={() => toggleSchedule(s.id).then(() => getSchedules().then(setSchedules))}>{s.enabled ? "Pause" : "Resume"}</button>
                        <button type="button" className="mini" style={{ color: "var(--c-err)", opacity: 0.8 }} onClick={() => removeSchedule(s.id).then(() => getSchedules().then(setSchedules))}>Delete</button>
                      </div>
                    </div>
                    {s.lastResult && <div style={{ fontSize: 12, marginTop: 2, opacity: 0.8, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 4 }}>{s.lastResult}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* people SAM knows by sight */}
            <div className="dash-sec">👥 People SAM knows ({people.length})</div>
            {people.length === 0
              ? <div className="dash-empty">No one yet — show SAM someone via 👁️ Look and say "remember this is …".</div>
              : <div className="dash-lanes">{people.map((p, i) => (
                  <div key={i} className="dash-lane on">
                    <span className="tm-emoji">🙂</span>
                    <span className="dash-lane-name">{p.name}{p.relation ? ` · ${p.relation}` : ""}</span>
                    <span className="dash-lane-keys" style={{ minWidth: "auto", opacity: .7 }}>{(p.look || "").slice(0, 40)}</span>
                  </div>
                ))}</div>}

            {/* activity */}
            <div className="dash-sec">Recent activity</div>
            {log.length === 0 ? <div className="dash-empty">Nothing yet — ask SAM something.</div> : (
              <ul className="dash-log">
                {log.map((e, i) => <li key={i}><span className="dash-time">{e.time}</span> {e.msg}</li>)}
              </ul>
            )}

            <div className="admin-foot">Running {s.defaultTier}-first on {s.platform}. Vault: {s.vault?.count ?? 0} notes. Everything local &amp; private.</div>
          </>
        )}
      </aside>
    </div>
  );
}
