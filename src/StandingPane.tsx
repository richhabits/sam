import { useEffect, useState } from "react";
import { getRoster, getStanding, standingArm, standingDisarm, standingRearm, standingRemove } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 🛰️ The Standing Crew — arm any of SAM's specialists to run its task in the background on a schedule.
// Double-gated OFF by default (SAM_STANDING flag + the "standing-crew" consent toggle); a risky action
// an armed agent triggers is held for approval via the Ask, never run unattended.

type Crew = { id: string; name: string; emoji: string; brief: string };
type Standing = { id: string; specialistId: string; task: string; cron: string; armed: boolean; lastRunAt?: string; lastResult?: string };

const CRON_HINTS = ["hourly", "every 30m", "every 2h", "daily 09:00", "weekly mon 09:00"];

export default function StandingPane({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [list, setList] = useState<Standing[]>([]);
  const [on, setOn] = useState(true);
  const [spec, setSpec] = useState("");
  const [task, setTask] = useState("");
  const [cron, setCron] = useState("daily 09:00");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => getStanding().then((d) => { setList(d.list || []); setOn(d.on !== false); }).catch(() => setErr("Couldn't load the crew."));
  useEffect(() => {
    getRoster().then((d) => { const c = d.crew || d || []; setCrew(c); if (c[0]) setSpec(c[0].id); }).catch(() => {});
    load();
  }, []);

  const arm = async () => {
    setErr("");
    if (!spec || !task.trim()) { setErr("Pick a specialist and give it a task."); return; }
    setBusy(true);
    try { const r = await standingArm(spec, task.trim(), cron); if (r?.error) setErr(r.error); else { setTask(""); load(); } }
    catch { setErr("Couldn't arm that agent."); } finally { setBusy(false); }
  };
  const act = async (fn: (id: string) => Promise<any>, id: string) => { await fn(id).catch(() => {}); load(); };
  const nameOf = (id: string) => crew.find((c) => c.id === id);

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">🛰️ The Standing Crew</div>
            <div className="drawer-sub">Arm a specialist to work in the <b>background on a schedule</b>. Risky steps pause for your OK — never run unattended.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: "6px 20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {!on && <div style={{ fontSize: 13, padding: "10px 13px", borderRadius: 10, background: "var(--accent-soft)", color: "var(--accent-text)" }}>
            Armed agents <b>won't fire yet</b> — turn on the <b>Standing Crew</b> in "What can SAM do on its own?" (and set <code>SAM_STANDING=1</code>). Arming still works; they start when you enable it.
          </div>}

          {/* Arm form */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 15, border: "1px solid var(--border)", borderRadius: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Arm a background agent</div>
            <select value={spec} onChange={(e) => setSpec(e.target.value)} style={{ padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 }}>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.emoji} {c.name} — {c.brief?.slice(0, 48)}</option>)}
            </select>
            <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="What should it do each run? e.g. “scan my inbox and flag anything urgent”" rows={2}
              style={{ padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, resize: "vertical" }} />
            <input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="daily 09:00"
              style={{ padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 }} />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {CRON_HINTS.map((h) => <button key={h} type="button" onClick={() => setCron(h)} style={{ fontSize: 12, padding: "4px 9px", borderRadius: 7, border: "1px solid var(--border)", background: cron === h ? "var(--accent-soft)" : "transparent", color: cron === h ? "var(--accent-text)" : "var(--muted)", cursor: "pointer" }}>{h}</button>)}
            </div>
            {err && <div style={{ color: "var(--c-err,#EF4444)", fontSize: 13 }}>{err}</div>}
            <button type="button" onClick={arm} disabled={busy} className="dl-btn primary" style={{ alignSelf: "flex-start" }}>{busy ? "Arming…" : "＋ Arm agent"}</button>
          </div>

          {/* The crew */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", margin: "4px 0 8px" }}>On duty ({list.length})</div>
            {list.length === 0 ? <div className="drawer-empty">No agents armed yet — pick one above.</div> : list.map((a) => {
              const c = nameOf(a.specialistId);
              return (
                <div key={a.id} style={{ padding: "12px 0", borderTop: "1px solid var(--border)", opacity: a.armed ? 1 : 0.55 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontWeight: 700 }}>{c?.emoji} {c?.name || a.specialistId}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--muted)" }}>{a.cron}{a.armed ? "" : " · paused"}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--muted)", margin: "3px 0" }}>{a.task}</div>
                  {a.lastResult && <div style={{ fontSize: 12, color: "var(--muted)", opacity: 0.85 }}>Last: {a.lastResult.slice(0, 120)}</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {a.armed
                      ? <button type="button" onClick={() => act(standingDisarm, a.id)} style={btn}>Pause</button>
                      : <button type="button" onClick={() => act(standingRearm, a.id)} style={btn}>Re-arm</button>}
                    <button type="button" onClick={() => act(standingRemove, a.id)} style={{ ...btn, color: "var(--c-err,#EF4444)" }}>Remove</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}

const btn: React.CSSProperties = { fontSize: 12.5, padding: "4px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
