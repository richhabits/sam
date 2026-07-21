import { useEffect, useMemo, useRef, useState } from "react";
import { getFlipit } from "./lib/api";

// 💷 FLIP IT — the money desk. A full major view (like Studio), read-only, live from
// /api/flipit. Nothing here trades, and nothing here writes: the rig is a separate thing
// that this screen only ever watches.
//
// Its real job is the WATCHDOG. The rig steps forward on a weekday evening; a step that
// quietly fails to run is the most expensive thing that can go wrong, because nothing else
// would say so. That card sits directly under the numbers and goes red on its own.
//
// Built phone-first: 390px is the primary target, since this gets read on a phone over the
// local network far more often than at a desk.

type Day = { date: string; ret: number; equity: number; cumNet: number; tradesCum: number };
type Holding = { ticker: string; score: number; price?: number; chg7?: number; chg30?: number; spark?: number[]; weight: number };
type Loop = {
  lastRun: number | null; lastOk: boolean; lastDetail: string;
  previousScheduled: number | null; nextScheduled: number | null; stale: boolean;
};
type Rig = {
  present: boolean; schema?: number; strategy?: string | null; targetVol?: number | null;
  now?: { equity: number; rung: number; hwm: number; drawdown: number; seeded: boolean; status: string | null;
          days: number; target: number; trades: number; tradeTarget: number; inBand: boolean | null; cumNet: number | null } | null;
  series?: Day[] | null;
  holdings?: Holding[] | null;
  trades?: unknown[]; tradesAvailable?: boolean;
  pending?: { count: number; items: any[] } | null;
  law?: { constitution: string | null; amendments: any[] } | null;
  loop?: Loop | null;
  breadth?: { pct_up?: number; regime?: string; avg30?: number } | null;
  degraded?: string[];
};

const LADDER = [5, 10, 20, 40, 80, 160, 320, 640, 1280];
const gbp = (n = 0) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number, dp = 2) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(dp)}%`;

// "4 minutes ago" / "in 3 hours" — plain words, because a raw timestamp makes you do maths
// at the exact moment you want an answer.
function relative(ms: number, now: number): string {
  const d = Math.abs(ms - now), future = ms > now;
  const mins = Math.round(d / 60000);
  if (mins < 1) return future ? "in under a minute" : "just now";
  const say = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const body = mins < 60 ? say(mins, "minute")
    : mins < 60 * 36 ? say(Math.round(mins / 60), "hour")
    : say(Math.round(mins / 1440), "day");
  return future ? `in ${body}` : `${body} ago`;
}

const palette = {
  "--ink": "#100E0C", "--ink-2": "#17130F", "--surface": "#1C1712", "--paper": "#F3EDE4",
  "--ash": "#B8AFA4", "--line": "rgba(240,130,78,.16)", "--ember": "#F0824E", "--ember-deep": "#E8673A",
  "--ember-soft": "rgba(240,130,78,.14)", "--live": "#5FD08A", "--c-err": "#EF4444", "--gold": "#D8B26A",
} as React.CSSProperties;

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 18, padding: 18,
};
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase",
  color: "var(--ash)", margin: "0 0 12px",
};

// ── The equity curve ─────────────────────────────────────────────────────────
// Hand-drawn SVG rather than a charting dependency: it's one line and a reference
// mark, and a library would be more code than the drawing.
function Curve({ series, onPick, picked }: { series: Day[]; onPick: (i: number | null) => void; picked: number | null }) {
  const W = 100, H = 46, PAD = 3;
  if (series.length < 2) {
    return (
      <div style={{ color: "var(--ash)", fontSize: 13, padding: "18px 0", textAlign: "center" }}>
        {series.length === 1
          ? `One day so far — ${pct(series[0].cumNet)}. The curve draws itself from the second.`
          : "The curve appears once the rig has lived a day."}
      </div>
    );
  }
  const vals = series.map((d) => d.equity);
  const lo = Math.min(...vals, 1), hi = Math.max(...vals, 1), span = hi - lo || 1;
  const x = (i: number) => (i / (series.length - 1)) * W;
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const line = series.map((d, i) => `${x(i)},${y(d.equity)}`).join(" ");
  const area = `${line} ${W},${H} 0,${H}`;
  const up = series[series.length - 1].cumNet >= 0;
  const stroke = up ? "var(--live)" : "var(--c-err)";

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: 132, display: "block", touchAction: "manipulation" }} role="img" aria-label="Equity curve">
        <title>Equity since the forward test began</title>
        <defs>
          <linearGradient id="fillCurve" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "rgba(95,208,138,.30)" : "rgba(239,68,68,.26)"} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>
        {/* the starting line — above it is profit, below it is not */}
        <line x1="0" y1={y(1)} x2={W} y2={y(1)} stroke="var(--ash)" strokeWidth={0.3} strokeDasharray="1.5 1.5" opacity={0.55} />
        <polygon points={area} fill="url(#fillCurve)" />
        <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.1} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {picked !== null && series[picked] && (
          <circle cx={x(picked)} cy={y(series[picked].equity)} r={1.6} fill={stroke} stroke="var(--ink)" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {/* One tap target per day, laid over the drawing — a finger can't hit a 1px vertex. */}
      <div style={{ display: "flex", marginTop: -132, height: 132, position: "relative" }}>
        {series.map((d, i) => (
          <button
            key={d.date} type="button"
            onClick={() => onPick(picked === i ? null : i)}
            aria-label={`${d.date}: ${pct(d.cumNet)}`}
            style={{ flex: 1, background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ash)", marginTop: 10 }}>
        {picked !== null && series[picked] ? (
          <>
            <span>{series[picked].date}</span>
            <span style={{ color: series[picked].ret >= 0 ? "var(--live)" : "var(--c-err)", fontWeight: 700 }}>
              {pct(series[picked].ret)} that day · {pct(series[picked].cumNet)} overall
            </span>
          </>
        ) : (
          <>
            <span>{series[0].date}</span>
            <span style={{ color: "var(--ash)" }}>tap any day</span>
            <span>{series[series.length - 1].date}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── The watchdog ─────────────────────────────────────────────────────────────
// The reason the desk exists. Green while the schedule is being kept; entirely red
// the moment a step is overdue and unanswered.
function Watchdog({ loop, now }: { loop: Loop | null; now: number }) {
  if (!loop) return null;
  const { stale, lastRun, lastOk, lastDetail, nextScheduled } = loop;
  const bad = stale || (lastRun !== null && !lastOk);
  const tone = stale ? "var(--c-err)" : lastOk ? "var(--live)" : "var(--ember)";

  return (
    <div style={{
      ...card,
      background: stale ? "rgba(239,68,68,.10)" : "var(--surface)",
      border: `1px solid ${stale ? "var(--c-err)" : "var(--line)"}`,
      boxShadow: stale ? "0 0 0 1px rgba(239,68,68,.35), 0 12px 34px rgba(239,68,68,.16)" : "none",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
        <span style={{ ...lbl, margin: 0 }}>The daily step</span>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800,
          padding: "4px 10px", borderRadius: 999, color: tone,
          background: stale ? "rgba(239,68,68,.16)" : lastOk ? "rgba(95,208,138,.13)" : "var(--ember-soft)",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: tone, display: "inline-block" }} />
          {stale ? "MISSED" : lastOk ? "RAN CLEAN" : "DIDN'T FINISH"}
        </span>
      </div>

      {stale ? (
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--c-err)", lineHeight: 1.4 }}>
          LOOP MISSED — check daily_step.log
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--paper)", marginTop: 6, opacity: .85 }}>
            A step was due {loop.previousScheduled ? relative(loop.previousScheduled, now) : "earlier"} and nothing has reported since.
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.02em", color: bad ? "var(--ember)" : "var(--paper)" }}>
          {lastRun ? `Ran ${relative(lastRun, now)}` : "No step recorded yet"}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "space-between", fontSize: 12.5, color: "var(--ash)", marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <span>Next {nextScheduled ? relative(nextScheduled, now) : "—"}</span>
        {nextScheduled && (
          <span style={{ color: "var(--paper)", fontVariantNumeric: "tabular-nums" }}>
            {new Date(nextScheduled).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      {lastDetail && !stale && (
        <div style={{ fontSize: 11.5, color: "var(--ash)", marginTop: 8, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", wordBreak: "break-word", opacity: .8 }}>
          {lastDetail}
        </div>
      )}
    </div>
  );
}

function Ladder({ rung, equity, hwm }: { rung: number; equity: number; hwm: number }) {
  const shown = LADDER.slice(0, Math.max(rung + 4, 5));
  return (
    <div>
    {/* Reversed so the ladder reads the way it climbs: the current rung sits at the
        bottom and the ones still to come stack above it. The high-water note stays
        OUTSIDE this container — inside, the reversal would fling it to the top. */}
    <div style={{ display: "flex", flexDirection: "column-reverse", gap: 2 }}>
      {shown.map((base, i) => {
        const here = i === rung, done = i < rung;
        return (
          <div key={base} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", opacity: i > rung ? .38 : 1 }}>
            <div style={{
              width: 4, alignSelf: "stretch", borderRadius: 999, minHeight: 22,
              background: here ? "var(--gold)" : done ? "var(--ember)" : "var(--line)",
              boxShadow: here ? "0 0 12px rgba(216,178,106,.55)" : "none",
            }} />
            <div style={{ flex: 1, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontWeight: here ? 800 : 600, fontSize: here ? 16 : 14, color: here ? "var(--gold)" : done ? "var(--paper)" : "var(--ash)" }}>
                £{base}
              </span>
              <span style={{ fontSize: 12, color: "var(--ash)" }}>
                {here ? `now ${gbp(equity)} → £${base * 2} to climb` : done ? "cleared" : `→ £${base * 2}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
      <div style={{ fontSize: 12, color: "var(--ash)", marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
        High-water {gbp(hwm)}
      </div>
    </div>
  );
}

function Sparkline({ vals, up }: { vals: number[]; up: boolean }) {
  if (!vals || vals.length < 2) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${30 - ((v - lo) / span) * 26 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" style={{ width: "100%", height: 30 }} role="img" aria-label={up ? "trend up" : "trend down"}>
      <title>{up ? "trend up" : "trend down"}</title>
      <polyline points={pts} fill="none" stroke={up ? "var(--live)" : "var(--c-err)"} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type Tab = "holdings" | "log" | "law";

export default function FlipItView() {
  const [d, setD] = useState<Rig | null>(null);
  const [err, setErr] = useState(false);
  const [tab, setTab] = useState<Tab>("holdings");
  const [picked, setPicked] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const alive = useRef(true);

  // One polled read, paused while the tab is hidden — a desk left open overnight should
  // cost nothing, and must never be a source of load on the machine running the rig.
  useEffect(() => {
    alive.current = true;
    document.title = "FLIP IT · SAM";
    const pull = () => {
      getFlipit().then((r) => { if (alive.current) { setD(r); setErr(false); } }).catch(() => { if (alive.current) setErr(true); });
    };
    // The FIRST read always happens. Only the repeat is skipped while hidden — a tab
    // opened in the background is still a tab you'll look at, and it must not be sitting
    // on skeletons when you get to it.
    pull();
    const poll = setInterval(() => { if (!document.hidden) pull(); }, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 30_000);   // keeps "in 3 hours" honest
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); pull(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive.current = false; clearInterval(poll); clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const back = () => {
    const sd = (globalThis as any).samDesktop;
    if (sd?.close) sd.close(); else window.close();
    if (!window.closed) location.href = location.pathname;
  };

  const series = useMemo(() => d?.series ?? [], [d]);
  const n = d?.now ?? null;

  const wrap: React.CSSProperties = {
    ...palette,
    minHeight: "100vh",
    background: "radial-gradient(900px 460px at 50% -12%, rgba(240,130,78,.12), transparent 62%), var(--ink)",
    color: "var(--paper)",
    fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
    WebkitFontSmoothing: "antialiased",
  };
  // Phone first: one column by default, widening only where there's genuinely room.
  const shell: React.CSSProperties = { maxWidth: 720, margin: "0 auto", padding: "18px 16px 64px" };
  const stack: React.CSSProperties = { display: "grid", gap: 14 };

  const tabBtn = (t: Tab): React.CSSProperties => ({
    flex: 1, padding: "9px 8px", borderRadius: 10, border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: 700, letterSpacing: ".01em",
    background: tab === t ? "var(--surface)" : "transparent",
    color: tab === t ? "var(--paper)" : "var(--ash)",
    boxShadow: tab === t ? "0 1px 0 rgba(255,255,255,.04) inset" : "none",
  });

  return (
    <div style={wrap}>
      <div style={shell}>
        {/* masthead */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-.03em" }}>FLIP IT</div>
            <div style={{ fontSize: 12, color: "var(--ash)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              read-only · nothing here trades
            </div>
          </div>
          <button type="button" onClick={back} style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--paper)", borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>
            ← SAM
          </button>
        </div>

        {err || (d && !d.present) ? (
          <div style={{ ...card, textAlign: "center", padding: 40 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>FLIP IT isn't set up on this machine</div>
            <div style={{ color: "var(--ash)", fontSize: 13.5, lineHeight: 1.5 }}>
              It lives in <code>~/flip-it</code> (or set <code>FLIPIT_DIR</code>). A private rig — not part of a normal SAM install.
            </div>
          </div>
        ) : !d || !n ? (
          // Skeletons, not a spinner: the shape of the answer arrives before the answer.
          <div style={stack}>
            {[92, 148, 190].map((h) => (
              <div key={h} style={{ ...card, height: h, background: "linear-gradient(90deg,var(--surface),var(--ink-2),var(--surface))", backgroundSize: "200% 100%", animation: "flipitPulse 1.4s ease-in-out infinite" }} />
            ))}
            <style>{"@keyframes flipitPulse{0%{background-position:0% 0}100%{background-position:-200% 0}}"}</style>
          </div>
        ) : (
          <div style={stack}>
            {/* ── status strip ── */}
            <div style={{ ...card, padding: 20, background: "linear-gradient(150deg, rgba(240,130,78,.10), var(--surface) 55%)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-.045em", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {gbp(n.equity)}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, color: "var(--ash)" }}>Rung {n.rung}</div>
                  <div style={{ fontSize: 12, color: "var(--ash)" }}>HWM {gbp(n.hwm)}</div>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 14 }}>
                {n.inBand !== null && (
                  <span style={{ fontSize: 11.5, fontWeight: 800, padding: "4px 10px", borderRadius: 999, color: n.inBand ? "var(--live)" : "var(--c-err)", background: n.inBand ? "rgba(95,208,138,.13)" : "rgba(239,68,68,.14)" }}>
                    BAND {n.inBand ? "IN" : "OUT"}
                  </span>
                )}
                {n.status && (
                  <span style={{ fontSize: 11.5, fontWeight: 800, padding: "4px 10px", borderRadius: 999, color: "var(--ember)", background: "var(--ember-soft)" }}>
                    {n.status.toUpperCase()}
                  </span>
                )}
                {n.cumNet !== null && (
                  <span style={{ fontSize: 11.5, fontWeight: 800, padding: "4px 10px", borderRadius: 999, color: n.cumNet >= 0 ? "var(--live)" : "var(--c-err)", background: n.cumNet >= 0 ? "rgba(95,208,138,.13)" : "rgba(239,68,68,.14)" }}>
                    {pct(n.cumNet)}
                  </span>
                )}
                {n.drawdown > 0 && (
                  <span style={{ fontSize: 11.5, fontWeight: 800, padding: "4px 10px", borderRadius: 999, color: "var(--ember)", background: "var(--ember-soft)" }}>
                    −{(n.drawdown * 100).toFixed(1)}% from high
                  </span>
                )}
              </div>

              <div style={{ height: 7, borderRadius: 999, background: "var(--ink-2)", overflow: "hidden", border: "1px solid var(--line)", marginTop: 16 }}>
                <div style={{ width: `${Math.min(100, (n.days / (n.target || 60)) * 100)}%`, height: "100%", background: "linear-gradient(90deg,var(--ember-deep),var(--ember))", borderRadius: 999 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--ash)", marginTop: 8 }}>
                <span>Day <b style={{ color: "var(--paper)" }}>{n.days}</b> of {n.target}</span>
                <span><b style={{ color: "var(--paper)" }}>{n.trades}</b> of {n.tradeTarget} trades</span>
              </div>
            </div>

            {/* ── the watchdog: the reason this screen exists ── */}
            <Watchdog loop={d.loop ?? null} now={now} />

            {/* ── pending orders, only when there are any ── */}
            {!!d.pending?.count && (
              <div style={{ ...card, border: "1px solid var(--ember)", background: "rgba(240,130,78,.08)" }}>
                <div style={{ ...lbl, color: "var(--ember)" }}>{d.pending.count} order{d.pending.count === 1 ? "" : "s"} awaiting approval</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {d.pending.items.slice(0, 8).map((o: any) => (
                    <div key={JSON.stringify(o)} style={{ fontSize: 13, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace", color: "var(--paper)" }}>
                      {[o?.side, o?.ticker, o?.amount ?? o?.qty].filter(Boolean).join(" ") || JSON.stringify(o).slice(0, 90)}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--ash)", marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  Approve in the terminal. This desk never places or approves an order.
                </div>
              </div>
            )}

            {/* ── equity curve ── */}
            <div style={card}>
              <div style={lbl}>Equity · since the forward test began</div>
              <Curve series={series} onPick={setPicked} picked={picked} />
            </div>

            {/* ── ladder ── */}
            <div style={card}>
              <div style={lbl}>The ladder · each rung doubles</div>
              <Ladder rung={n.rung} equity={n.equity} hwm={n.hwm} />
            </div>

            {/* ── tabs ── */}
            <div>
              <div style={{ display: "flex", gap: 4, background: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 13, padding: 4, marginBottom: 12 }}>
                <button type="button" style={tabBtn("holdings")} onClick={() => setTab("holdings")}>Holdings</button>
                <button type="button" style={tabBtn("log")} onClick={() => setTab("log")}>Trade log</button>
                <button type="button" style={tabBtn("law")} onClick={() => setTab("law")}>The Law</button>
              </div>

              {tab === "holdings" && (
                <div style={{ display: "grid", gap: 10 }}>
                  {(d.holdings ?? []).map((h) => {
                    const up = (h.chg30 ?? 0) >= 0;
                    return (
                      <div key={h.ticker} style={{ ...card, padding: 14 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                          <span style={{ fontWeight: 800, fontSize: 17 }}>{h.ticker}</span>
                          <span style={{ fontSize: 13, color: "var(--ash)", fontVariantNumeric: "tabular-nums" }}>
                            {(h.weight * 100).toFixed(0)}%{typeof h.price === "number" ? ` · $${h.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}
                          </span>
                        </div>
                        {h.spark && <div style={{ margin: "8px 0 4px" }}><Sparkline vals={h.spark} up={up} /></div>}
                        <div style={{ display: "flex", gap: 12, fontSize: 12.5, marginTop: 4 }}>
                          {typeof h.chg7 === "number" && <span style={{ color: h.chg7 >= 0 ? "var(--live)" : "var(--c-err)", fontWeight: 700 }}>{pct(h.chg7, 1)} <span style={{ color: "var(--ash)", fontWeight: 500 }}>7d</span></span>}
                          {typeof h.chg30 === "number" && <span style={{ color: up ? "var(--live)" : "var(--c-err)", fontWeight: 700 }}>{pct(h.chg30, 1)} <span style={{ color: "var(--ash)", fontWeight: 500 }}>30d</span></span>}
                        </div>
                      </div>
                    );
                  })}
                  {!(d.holdings ?? []).length && <div style={{ ...card, color: "var(--ash)", fontSize: 13 }}>Holdings appear after the next daily step.</div>}
                </div>
              )}

              {tab === "log" && (
                <div style={{ ...card, color: "var(--ash)", fontSize: 13.5, lineHeight: 1.55 }}>
                  {/* Said plainly rather than faked: the journal keeps a running count, not
                      individual fills, so there is no per-trade history to show. */}
                  <b style={{ color: "var(--paper)" }}>{n.trades} trade{n.trades === 1 ? "" : "s"} so far</b>, of {n.tradeTarget} needed.
                  <div style={{ marginTop: 8 }}>
                    The forward journal records a running count per day rather than individual fills,
                    so there's no per-trade history to list here yet.
                  </div>
                </div>
              )}

              {tab === "law" && (
                <div style={{ display: "grid", gap: 10 }}>
                  {(d.law?.amendments ?? []).map((a: any) => (
                    <div key={a?.id ?? a?.date ?? JSON.stringify(a).slice(0, 60)} style={{ ...card, padding: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                        <span style={{ fontWeight: 800, color: "var(--gold)" }}>{a?.id ?? "amendment"}</span>
                        <span style={{ fontSize: 12, color: "var(--ash)" }}>{a?.date ?? ""}</span>
                      </div>
                      {a?.reason && <div style={{ fontSize: 13, color: "var(--paper)", marginTop: 8, lineHeight: 1.5, opacity: .9 }}>{a.reason}</div>}
                      {a?.stiffens && <div style={{ fontSize: 12, color: "var(--ash)", marginTop: 8 }}>Stiffens: {a.stiffens}</div>}
                    </div>
                  ))}
                  <div style={{ ...card, padding: 16 }}>
                    <div style={lbl}>The constitution</div>
                    {d.law?.constitution ? (
                      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12.5, lineHeight: 1.6, color: "var(--paper)", opacity: .88, margin: 0, fontFamily: "ui-monospace,SFMono-Regular,Menlo,monospace" }}>
                        {d.law.constitution}
                      </pre>
                    ) : (
                      <div style={{ color: "var(--ash)", fontSize: 13 }}>Not readable from here.</div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--ash)", marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                      Shown as it is on disk. This desk can't change a word of it.
                    </div>
                  </div>
                </div>
              )}
            </div>

            {!!d.degraded?.length && (
              <div style={{ fontSize: 12, color: "var(--ash)", textAlign: "center" }}>
                Couldn't read: {d.degraded.join(", ")} — everything else is live.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
