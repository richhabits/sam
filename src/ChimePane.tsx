import { useEffect, useState } from "react";
import { getChimes, setChimeTimer, setChimeAlarm, cancelChimeApi, snoozeChimeApi } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// ⏰ The Chime — alarms + named timers. The store always works; whether a due chime actually RINGS
// is gated by SAM_CHIME (a due one only ever notifies — it never runs a tool). This pane sets/lists/
// cancels/snoozes them; a hint shows when ringing is off.

type Chime = { id: string; label: string; kind: "timer" | "alarm"; fireAt?: string; recur?: string; snoozedUntil?: string };

const QUICK_MIN = [5, 10, 20, 60];

// Next occurrence of an HH:MM wall-clock time, as an ISO instant (today if still ahead, else tomorrow).
function nextAt(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setSeconds(0, 0); d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function whenLabel(c: Chime): string {
  if (c.snoozedUntil && new Date(c.snoozedUntil) > new Date()) return `snoozed → ${new Date(c.snoozedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (c.recur) return c.recur;
  if (!c.fireAt) return "";
  const d = new Date(c.fireAt); const soon = d.getTime() - Date.now();
  if (c.kind === "timer" && soon > 0) { const m = Math.round(soon / 60000); return m >= 1 ? `in ${m} min` : "in <1 min"; }
  const today = d.toDateString() === new Date().toDateString();
  return `${today ? "" : "tomorrow "}${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function ChimePane({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [tab, setTab] = useState<"timer" | "alarm">("timer");
  const [list, setList] = useState<Chime[]>([]);
  const [label, setLabel] = useState("");
  const [mins, setMins] = useState(10);
  const [time, setTime] = useState("07:00");
  const [recur, setRecur] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => getChimes().then((d) => setList(d.chimes || [])).catch(() => setErr("Couldn't load your chimes."));
  // biome-ignore lint/correctness/useExhaustiveDependencies: poll once on mount; load is stable
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);

  const add = async () => {
    setErr(""); setBusy(true);
    try {
      const r = tab === "timer"
        ? await setChimeTimer(label.trim() || `${mins}-minute timer`, mins * 60000)
        : await setChimeAlarm(label.trim() || "Alarm", nextAt(time), recur ? `daily ${time}` : undefined);
      if (r?.error) setErr(r.error); else { setLabel(""); load(); }
    } catch { setErr("Couldn't set that."); } finally { setBusy(false); }
  };
  const act = async (fn: (id: string) => Promise<any>, id: string) => { await fn(id).catch(() => undefined); load(); };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">⏰ Alarms &amp; Timers</div>
            <div className="drawer-sub">Set a timer or an alarm. SAM rings even with the window shut.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div style={{ padding: "6px 20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, padding: 4, background: "var(--surface-2, var(--bg))", borderRadius: 12 }}>
            {(["timer", "alarm"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 14,
                  background: tab === t ? "var(--accent)" : "transparent", color: tab === t ? "#fff" : "var(--muted)" }}>
                {t === "timer" ? "⏱ Timer" : "⏰ Alarm"}
              </button>
            ))}
          </div>

          {/* Compose */}
          <div style={{ display: "flex", flexDirection: "column", gap: 11, padding: 15, border: "1px solid var(--border)", borderRadius: 14 }}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tab === "timer" ? "What's it for? e.g. “tea”" : "Alarm name e.g. “wake up”"}
              style={inp} />
            {tab === "timer" ? (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {QUICK_MIN.map((q) => <button key={q} type="button" onClick={() => setMins(q)} style={chip(mins === q)}>{q < 60 ? `${q} min` : "1 hr"}</button>)}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="number" min={1} max={1440} value={mins} onChange={(e) => setMins(Math.max(1, Number(e.target.value) || 1))} style={{ ...inp, width: 90 }} />
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>minutes</span>
                </div>
              </>
            ) : (
              <>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ ...inp, width: 140 }} />
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, color: "var(--muted)", cursor: "pointer" }}>
                  <input type="checkbox" checked={recur} onChange={(e) => setRecur(e.target.checked)} /> Repeat every day
                </label>
              </>
            )}
            {err && <div style={{ color: "var(--c-err,#EF4444)", fontSize: 13 }}>{err}</div>}
            <button type="button" onClick={add} disabled={busy} className="dl-btn primary" style={{ alignSelf: "flex-start" }}>
              {busy ? "Setting…" : tab === "timer" ? "＋ Start timer" : "＋ Set alarm"}
            </button>
          </div>

          {/* Active */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", margin: "4px 0 8px" }}>Active ({list.length})</div>
            {list.length === 0 ? <div className="drawer-empty">Nothing set — add a timer or alarm above.</div> : list.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 0", borderTop: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{c.kind === "timer" ? "⏱" : "⏰"} {c.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted)", fontFamily: "var(--mono)" }}>{whenLabel(c)}</div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={() => act((id) => snoozeChimeApi(id), c.id)} style={btn}>Snooze 9m</button>
                  <button type="button" onClick={() => act(cancelChimeApi, c.id)} style={{ ...btn, color: "var(--c-err,#EF4444)" }}>Cancel</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}

const inp: React.CSSProperties = { padding: "9px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 };
const btn: React.CSSProperties = { fontSize: 12.5, padding: "4px 11px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer" };
const chip = (on: boolean): React.CSSProperties => ({ fontSize: 13, padding: "5px 12px", borderRadius: 9, border: "1px solid var(--border)", background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent-text)" : "var(--muted)", cursor: "pointer", fontWeight: 600 });
