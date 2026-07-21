import { useState, useEffect } from "react";
import Icon from "./Icon";
import { getStatus, getLog, getSecurity, getSwarms, approveSwarmAgent, type Swarm, getSchedules, toggleSchedule, removeSchedule, type Schedule, getPeople, getYard, cancelYardJob,
  pairToken, setPairToken, requestYardPairing, collectYardPairing, yardPairPending, approveYardPairing, denyYardPairing, revokeYardPairing } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// SAM control centre — one glance at everything: brains, tools, memory, activity.
const PROVIDER_LABEL: Record<string, string> = {
  cerebras: "Cerebras", groq: "Groq", nvidia: "NVIDIA", mistral: "Mistral",
  github: "GitHub Models", gemini: "Gemini", openrouter: "OpenRouter",
  anthropic: "Claude", openai: "OpenAI",
};

export default function Dashboard({ onClose, onAddKeys }: { onClose: () => void; onAddKeys?: () => void }) {
  const [s, setS] = useState<any>(null);
  const [log, setLog] = useState<{ time: string; msg: string }[]>([]);
  const [sec, setSec] = useState<any>(null);
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [yard, setYard] = useState<any>(null);
  const [yardErr, setYardErr] = useState<string>("");
  // Pairing has two sides and this one component is both, because it is the same bundle:
  // in a browser it ASKS, in the desktop app (which holds the passkey) it APPROVES.
  const [pairing, setPairing] = useState<{ id: string; code: string } | null>(null);
  const [paired, setPaired] = useState(!!pairToken());
  const [pairInbox, setPairInbox] = useState<{ pending: any[]; paired: any[]; notApp?: boolean }>({ pending: [], paired: [] });
  // Re-read the yard straight after acting on it, so the panel reflects the kill
  // immediately rather than at the next five-second tick.
  const refreshYard = () => { getYard().then(setYard).catch(() => {/* the next poll re-reads the truth */}); };

  // While a request is outstanding, wait for it to be approved in the app. Polling the
  // browser's OWN request id means it never learns about anyone else's.
  useEffect(() => {
    if (!pairing) return;
    const iv = setInterval(() => {
      collectYardPairing(pairing.id).then((r: any) => {
        if (!r?.token) return;
        setPairToken(r.token); setPaired(true); setPairing(null); setYardErr("");
      }).catch(() => {/* still waiting */});
    }, 1500);
    const giveUp = setTimeout(() => setPairing(null), 2 * 60_000);   // the request expires server-side too
    return () => { clearInterval(iv); clearTimeout(giveUp); };
  }, [pairing]);
  useEscape(onClose);

  useEffect(() => {
    const load = () => {
      getStatus().then(setS).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
      getLog().then((l) => setLog(l.slice(-8).reverse())).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
      getSecurity().then((d) => setSec(d.status)).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
      getSwarms().then(setSwarms).catch(() => {/* background poll — the next tick retries */});
      getPeople().then((p) => setPeople(Array.isArray(p) ? p : [])).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
      getSchedules().then(setSchedules).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
      getYard().then(setYard).catch(() => {/* the yard may be off, or this SAM may not have it — the tile simply stays hidden */});
      // Only the app gets a list back; a browser is told nothing about who else is waiting.
      yardPairPending().then(setPairInbox).catch(() => {/* not the app — nothing to approve here */});
    };
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, []);

  // The drawer was one long scroll — stats, 42 brain lanes, security, swarms, schedules, people
  // and the activity log stacked in a single column. Tabs keep each view about a screen tall.
  const [tab, setTab] = useState<"overview" | "brains" | "auto" | "people" | "activity">("overview");
  const [showAllLanes, setShowAllLanes] = useState(false);
  const providers = s?.models?.providers || [];
  const freeLive = providers.filter((p: any) => p.tier === "free" && p.keys > 0);
  const freeTotal = providers.filter((p: any) => p.tier === "free").length;
  // A control centre should show what IS running. Listing all 42 lanes meant ~35 rows reading "—",
  // so the panel was mostly a list of things the user does NOT have — the opposite of "at a glance".
  const liveLanes = providers.filter((p: any) => p.keys > 0);
  const dormantLanes = providers.filter((p: any) => !(p.keys > 0));
  const shownLanes = showAllLanes ? [...liveLanes, ...dormantLanes] : liveLanes;

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
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        {!s ? <div className="dash-empty">Connecting to SAM…</div> : (
          <>
            <div className="dash-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
              <button type="button" role="tab" aria-selected={tab === "brains"} className={tab === "brains" ? "on" : ""} onClick={() => setTab("brains")}>Brains</button>
              <button type="button" role="tab" aria-selected={tab === "auto"} className={tab === "auto" ? "on" : ""} onClick={() => setTab("auto")}>Automations</button>
              <button type="button" role="tab" aria-selected={tab === "people"} className={tab === "people" ? "on" : ""} onClick={() => setTab("people")}>People</button>
              <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "on" : ""} onClick={() => setTab("activity")}>Activity</button>
            </div>
            {tab === "overview" && (<>
            {/* headline stats */}
            <div className="dash-grid">
              <div className="dash-stat"><Icon name="brain" className="dash-ic" /><span className="dash-num">{freeLive.length}</span><span className="dash-lbl">free brains live</span></div>
              <div className="dash-stat"><Icon name="settings" className="dash-ic" /><span className="dash-num">{s.tools}</span><span className="dash-lbl">tools</span></div>
              <div className="dash-stat"><Icon name="sparkle" className="dash-ic" /><span className="dash-num">{s.skills}</span><span className="dash-lbl">skills</span></div>
              <div className="dash-stat"><Icon name="book" className="dash-ic" /><span className="dash-num">{s.memory?.count ?? 0}</span><span className="dash-lbl">things remembered</span></div>
              <div className="dash-stat"><Icon name="briefcase" className="dash-ic" /><span className="dash-num">{s.projects}</span><span className="dash-lbl">brands</span></div>
              <div className="dash-stat"><Icon name="voice" className="dash-ic" /><span className="dash-num">{s.voice?.elevenlabs ? "ON" : "free"}</span><span className="dash-lbl">voice</span></div>
            </div>

            {/* security watchdog */}
            <div className="dash-sec"><Icon name="shield" /> Security</div>
            <div className={`dash-security ${sec && !sec.clear ? "flagged" : "clear"}`}>
              <span className="dash-shield">{sec && !sec.clear ? "⚠️" : "🛡️"}</span>
              <span>{sec ? sec.headline : "Checking…"}</span>
            </div>

            </>)}
            {tab === "brains" && (<>
            {/* brains */}
            <div className="dash-sec">
              <Icon name="brain" /> AI brains ({freeLive.length}/{freeTotal} free lanes ready)
              {/* This list shows a key count per provider, which reads as editable — it is not, and
                  a dead end here sends people hunting through menus for the panel that IS. One
                  link, no new clutter. */}
              {onAddKeys && (
                <button type="button" className="dash-sec-link" onClick={() => { onClose(); onAddKeys(); }}>
                  Add keys
                </button>
              )}
            </div>
            <div className="dash-lanes">
              {shownLanes.map((p: any) => (
                <button
                  type="button"
                  key={p.id}
                  className={`dash-lane ${p.keys > 0 ? "on" : ""}`}
                  title={onAddKeys ? `Add or edit a ${PROVIDER_LABEL[p.id] || p.id} key` : undefined}
                  onClick={onAddKeys ? () => { onClose(); onAddKeys(); } : undefined}
                >
                  <span className={`dash-dot ${p.keys > 0 ? "live" : ""}`} />
                  <span className="dash-lane-name">{PROVIDER_LABEL[p.id] || p.id}</span>
                  <span className="dash-lane-tier">{p.tier}</span>
                  <span className="dash-lane-keys">{p.keys > 0 ? `${p.keys} key${p.keys > 1 ? "s" : ""}` : "—"}</span>
                </button>
              ))}
              {dormantLanes.length > 0 && (
                <button type="button" className="dash-lane-more" onClick={() => setShowAllLanes((v) => !v)}>
                  {showAllLanes
                    ? "▾ hide the lanes with no key"
                    : `▸ ＋ ${dormantLanes.length} more lanes available — add a key to switch one on`}
                </button>
              )}
            </div>

            </>)}
            {tab === "auto" && (<>
            {/* THE YARD — long jobs run in their own process. Same reading as the money desk's
                watchdog: a worker that has stopped reporting is shown as stopped, never as busy,
                because silence and work look identical otherwise. Hidden entirely when off, so a
                SAM without the yard shows no dead switch. */}
            {yard?.on && (<>
              <div className="dash-sec">
                <Icon name="settings" /> The yard ({yard.depth} queued)
                {/* A build you cannot look at is a build you have to take on trust. */}
                <button type="button" className="dash-sec-link" onClick={() => window.open(`${location.pathname}?app=yard`, "_blank")}>
                  See what it built
                </button>
              </div>
              <div className="dash-lanes">
                <div className="dash-lane on" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: 999, display: "inline-block",
                        background: !yard.worker?.up ? "var(--c-err)" : yard.current?.stale ? "var(--c-warn)" : "var(--c-ok)",
                      }} />
                      {yard.worker?.up ? `Worker up (pid ${yard.worker.pid})` : "Worker down"}
                    </span>
                    <span style={{ fontSize: 11, opacity: .6 }}>
                      {yard.done} done · {yard.failed} failed · {yard.cancelled} cancelled
                    </span>
                  </div>

                  {yard.current ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13 }}>
                          {yard.current.stale ? "⚠️ " : ""}{yard.current.kind}
                          {yard.current.project ? ` · ${yard.current.project}` : ""}
                          {yard.current.stale && <span style={{ color: "var(--c-err)", fontWeight: 600 }}> — stopped reporting</span>}
                        </span>
                        {/* The one write on this panel. It signals the yard and nothing else on
                            the machine: the job settles between steps rather than being shot. */}
                        <button
                          type="button"
                          onClick={() => { setYardErr(""); cancelYardJob(yard.current.id).then(refreshYard).catch((e) => setYardErr(String(e?.message || e))); }}
                          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, border: "1px solid var(--c-err)", background: "transparent", color: "var(--c-err)", cursor: "pointer", fontWeight: 600 }}
                        >Kill</button>
                      </div>
                      {/* the meter — only shown when a ceiling was actually set */}
                      {yard.current.costBudget ? (
                        <div>
                          <div style={{ height: 5, borderRadius: 999, background: "var(--surface)", overflow: "hidden", border: "1px solid var(--border)" }}>
                            <div style={{
                              width: `${Math.min(100, (yard.current.costTokens / yard.current.costBudget) * 100)}%`, height: "100%",
                              background: yard.current.costTokens / yard.current.costBudget > 0.8 ? "var(--c-warn)" : "var(--c-blue)",
                            }} />
                          </div>
                          <div style={{ fontSize: 11, opacity: .6, marginTop: 3 }}>
                            {yard.current.costTokens.toLocaleString()} / {yard.current.costBudget.toLocaleString()} tokens
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, opacity: .6 }}>{yard.current.costTokens.toLocaleString()} tokens · no ceiling set</div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, opacity: .6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                      {yard.depth > 0 ? `${yard.depth} waiting to start` : "Idle — nothing building."}
                    </div>
                  )}

                  {/* A refused Kill says why, and offers the way out rather than being a
                      dead end: pair this browser, once, from the app. */}
                  {yardErr && (
                    <div style={{ fontSize: 11, color: "var(--c-warn)", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                      {yardErr}
                      {!paired && !pairing && (
                        <button
                          type="button"
                          onClick={() => { requestYardPairing(navigator.userAgent.includes("Chrome") ? "Chrome on this Mac" : "This browser").then((r: any) => setPairing(r)).catch(() => setYardErr("couldn't start pairing")); }}
                          style={{ marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--c-warn)", background: "transparent", color: "var(--c-warn)", cursor: "pointer", fontWeight: 600 }}
                        >Pair this browser</button>
                      )}
                    </div>
                  )}

                  {/* THE ASK — the browser shows a code and waits. The code is the point:
                      it is what the person compares before approving, so a request they
                      cannot see cannot be approved by a click meant for this one. */}
                  {pairing && (
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, textAlign: "center" }}>
                      <div style={{ fontSize: 11, opacity: .7, marginBottom: 6 }}>Approve this in the SAM app — check the number matches:</div>
                      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: ".22em", fontVariantNumeric: "tabular-nums" }}>{pairing.code}</div>
                      <div style={{ fontSize: 11, opacity: .6, marginTop: 6 }}>waiting… this expires in a couple of minutes</div>
                    </div>
                  )}
                  {paired && !pairing && (
                    <div style={{ fontSize: 11, opacity: .6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                      This browser is paired — it can start and stop work here.
                    </div>
                  )}

                  {/* THE APPROVAL — only rendered where the passkey is, i.e. the desktop app. */}
                  {!!pairInbox.pending?.length && (
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, display: "grid", gap: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--c-warn)" }}>A browser wants to control the yard</div>
                      {pairInbox.pending.map((p: any) => (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12 }}>
                            {p.label} · <b style={{ fontSize: 15, letterSpacing: ".18em", fontVariantNumeric: "tabular-nums" }}>{p.code}</b>
                          </span>
                          <span style={{ display: "flex", gap: 6 }}>
                            <button type="button" onClick={() => { approveYardPairing(p.id, p.code).then(() => yardPairPending().then(setPairInbox)).catch(() => {/* the next poll re-reads */}); }}
                              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, border: "1px solid var(--c-ok)", background: "transparent", color: "var(--c-ok)", cursor: "pointer", fontWeight: 600 }}>Approve</button>
                            <button type="button" onClick={() => { denyYardPairing(p.id).then(() => yardPairPending().then(setPairInbox)).catch(() => {/* the next poll re-reads */}); }}
                              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text-dim)", cursor: "pointer" }}>Deny</button>
                          </span>
                        </div>
                      ))}
                      <div style={{ fontSize: 10.5, opacity: .6 }}>Only approve a number you can see on your own screen.</div>
                    </div>
                  )}
                  {!!pairInbox.paired?.length && (
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8, display: "grid", gap: 4 }}>
                      {pairInbox.paired.map((b: any) => (
                        <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, opacity: .75 }}>
                          <span>paired · {b.label}</span>
                          <button type="button" onClick={() => { revokeYardPairing(b.id).then(() => yardPairPending().then(setPairInbox)).catch(() => {/* the next poll re-reads */}); }}
                            style={{ fontSize: 10.5, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--c-err)", cursor: "pointer" }}>Unpair</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* The last failure stays visible: a failure nobody sees is the same as one
                      that did not happen, and this is the panel where it should be seen. */}
                  {yard.lastFailure && (
                    <div style={{ fontSize: 11, color: "var(--c-err)", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                      Last failure ({yard.lastFailure.kind}): {String(yard.lastFailure.error ?? "").slice(0, 120)}
                    </div>
                  )}
                </div>
              </div>
            </>)}

            {/* swarm monitor */}
            <div className="dash-sec"><Icon name="team" /> Swarms ({swarms.filter(sw => sw.status === "running" || sw.status === "paused" || sw.status === "planning").length} active)</div>
            {swarms.length === 0 ? <div className="dash-empty">No swarms yet — use /swarm &lt;goal&gt; to launch one.</div> : (
              <div className="dash-lanes">
                {swarms.slice(-6).reverse().map((sw) => (
                  <div key={sw.id} className="dash-lane on" style={{ flexDirection: "column", alignItems: "stretch", gap: 6, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600 }}>{sw.goal.slice(0, 60)}{sw.goal.length > 60 ? "…" : ""}</span>
                      <span className={`dash-lane-tier`} style={{ background: sw.status === "done" ? "var(--c-ok)" : sw.status === "error" ? "var(--c-err)" : sw.status === "paused" ? "var(--c-warn)" : "var(--c-blue)", color: "var(--on-accent)", padding: "2px 8px", borderRadius: 4, fontSize: 11 }}>{sw.status}</span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                      {sw.agents.map((a) => (
                        <div key={a.id} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 4, background: a.status === "paused" ? "rgba(245,158,11,0.15)" : a.status === "done" ? "rgba(34,197,94,0.1)" : a.status === "error" ? "rgba(239,68,68,0.1)" : "var(--surface)", display: "flex", flexDirection: "column", gap: 2, minWidth: 120, border: "1px solid var(--border)" }}>
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
                    {sw.synthesis && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8, borderTop: "1px solid var(--border)", paddingTop: 6 }}>{sw.synthesis.slice(0, 200)}{sw.synthesis.length > 200 ? "…" : ""}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* schedules monitor */}
            <div className="dash-sec"><Icon name="clock" /> Scheduled tasks ({schedules.filter(s => s.enabled).length} active)</div>
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
                    {s.lastResult && <div style={{ fontSize: 12, marginTop: 2, opacity: 0.8, borderTop: "1px solid var(--border)", paddingTop: 4 }}>{s.lastResult}</div>}
                  </div>
                ))}
              </div>
            )}

            </>)}
            {tab === "people" && (<>
            {/* people SAM knows by sight */}
            <div className="dash-sec"><Icon name="people" /> People SAM knows ({people.length})</div>
            {people.length === 0
              ? <div className="dash-empty">No one yet — show SAM someone via 👁️ Look and say "remember this is …".</div>
              : <div className="dash-lanes">{people.map((p, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: render-only lane list; order is stable
                  <div key={i} className="dash-lane on">
                    <span className="tm-emoji">🙂</span>
                    <span className="dash-lane-name">{p.name}{p.relation ? ` · ${p.relation}` : ""}</span>
                    <span className="dash-lane-keys" style={{ minWidth: "auto", opacity: .7 }}>{(p.look || "").slice(0, 40)}</span>
                  </div>
                ))}</div>}

            </>)}
            {tab === "activity" && (<>
            {/* activity */}
            <div className="dash-sec">Recent activity</div>
            {log.length === 0 ? <div className="dash-empty">Nothing yet — ask SAM something.</div> : (
              <ul className="dash-log">
                {log.map((e, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only activity log; order is stable
                  <li key={i}><span className="dash-time">{e.time}</span> {e.msg}</li>
                ))}
              </ul>
            )}
            </>)}

            <div className="admin-foot">Running {s.defaultTier}-first on {s.platform}. Vault: {s.vault?.count ?? 0} notes. Everything local &amp; private.</div>
          </>
        )}
      </aside>
    </div>
  );
}
