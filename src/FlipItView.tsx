import { useEffect, useState } from "react";
import { getFlipit } from "./lib/api";

// 💷 FLIP IT — a full major view (like Studio), its own entity. The £5 trading rig's money desk,
// read-only, live from /api/flipit (~/flip-it). Never trades. Opened via ?app=flipit.

type Rig = {
  present: boolean;
  equity?: number; rung?: number; hwm?: number; seeded?: boolean; status?: string | null;
  strategy?: string; targetVol?: number | null;
  days?: number; trades?: number; target?: number; tradeTarget?: number;
  holdings?: { ticker: string; price?: number; chg30?: number; chg7?: number; spark?: number[] }[];
  breadth?: { pct_up?: number; regime?: string; avg30?: number } | null;
  movers?: { leaders?: { ticker: string; chg30: number }[]; laggards?: { ticker: string; chg30: number }[] } | null;
};

const gbp = (n = 0) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const LADDER = [5, 10, 20, 40, 80, 160, 320];

function Spark({ vals, up }: { vals: number[]; up: boolean }) {
  if (!vals || vals.length < 2) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * 100},${44 - ((v - lo) / span) * 40 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 100 44" preserveAspectRatio="none" style={{ width: "100%", height: 44 }} role="img" aria-label={up ? "trend up" : "trend down"}>
      <title>{up ? "trend up" : "trend down"}</title>
      <polyline points={pts} fill="none" stroke={up ? "var(--live,#5FD08A)" : "var(--c-err,#EF4444)"} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function FlipItView() {
  const [d, setD] = useState<Rig | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { getFlipit().then(setD).catch(() => setErr(true)); document.title = "FLIP IT · SAM"; }, []);

  const back = () => { const sd = (globalThis as any).samDesktop; if (sd?.close) sd.close(); else window.close(); if (!window.closed) location.href = location.pathname; };
  const dayPct = d?.present && d.target ? Math.min(100, ((d.days ?? 0) / d.target) * 100) : 0;
  const rungIdx = d?.rung ?? 0;

  // FLIP IT is a dark "money desk". The main app defines a LIGHT theme globally (e.g. --surface:#fff),
  // so we can't lean on undefined-var fallbacks — a global --surface:#fff would turn our cards white and
  // wash every label out. Pin the whole palette on this root so the view owns its colours end to end.
  const palette = {
    "--ink": "#100E0C", "--ink-2": "#17130F", "--surface": "#1C1712", "--paper": "#F3EDE4",
    "--ash": "#B8AFA4", "--line": "rgba(240,130,78,.16)", "--ember": "#F0824E", "--ember-deep": "#E8673A",
    "--ember-soft": "rgba(240,130,78,.14)", "--live": "#5FD08A", "--c-err": "#EF4444",
  } as React.CSSProperties;
  const wrap: React.CSSProperties = {
    ...palette,
    minHeight: "100vh", background: "radial-gradient(1000px 500px at 50% -10%, rgba(240,130,78,.10), transparent 60%), var(--ink,#100E0C)",
    color: "var(--paper,#F3EDE4)", fontFamily: "-apple-system,BlinkMacSystemFont,'SF Pro Display',system-ui,sans-serif",
  };
  const shell: React.CSSProperties = { maxWidth: 1120, margin: "0 auto", padding: "24px 26px 70px" };
  const card: React.CSSProperties = { background: "var(--surface,#1C1712)", border: "1px solid var(--line,rgba(240,130,78,.14))", borderRadius: 18, padding: 20 };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--ash,#9A9187)", margin: "0 0 12px" };

  return (
    <div style={wrap}>
      <div style={shell}>
        {/* masthead */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 30 }}>💷</span>
            <div>
              <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.03em" }}>FLIP IT</div>
              <div style={{ fontSize: 13, color: "var(--ash,#9A9187)" }}>SAM's £5 money desk · read-only · nothing here trades</div>
            </div>
          </div>
          <button type="button" onClick={back} style={{ background: "var(--surface,#1C1712)", border: "1px solid var(--line)", color: "var(--paper)", borderRadius: 10, padding: "8px 14px", cursor: "pointer", fontWeight: 600 }}>← Back to SAM</button>
        </div>

        {err || (d && !d.present) ? (
          <div style={{ ...card, textAlign: "center", padding: 44 }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>FLIP IT isn't set up on this machine</div>
            <div style={{ color: "var(--ash,#9A9187)", fontSize: 14 }}>It lives in <code>~/flip-it</code> (or set <code>FLIPIT_DIR</code>). A private £5 rig — not part of a normal SAM install.</div>
          </div>
        ) : !d ? (
          <div style={{ ...card, textAlign: "center", padding: 44, color: "var(--ash)" }}>Loading your rig…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 16, alignItems: "start" }}>
            {/* BALANCE */}
            <div style={{ gridColumn: "span 5", borderRadius: 20, padding: 24, color: "#fff", background: "linear-gradient(135deg,#0b7a4b,#12a06f 55%,#16b79a)", boxShadow: "0 14px 40px rgba(11,122,75,.32)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 600, opacity: .92 }}><span>Balance</span><span style={{ background: "rgba(255,255,255,.2)", padding: "3px 11px", borderRadius: 999 }}>Rung {rungIdx}</span></div>
              <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-.045em", lineHeight: 1, marginTop: 12 }}>{gbp(d.equity)}</div>
              <div style={{ fontSize: 13, opacity: .9, marginTop: 8 }}>{d.strategy ?? "mom_12_1"}{typeof d.targetVol === "number" ? ` · ${(d.targetVol * 100).toFixed(0)}% vol` : ""} · high-water {gbp(d.hwm)}</div>
            </div>

            {/* PAPER PROOF / GATES */}
            <div style={{ ...card, gridColumn: "span 7" }}>
              <div style={lbl}>Getting to real money · the paper proof</div>
              <div style={{ height: 8, borderRadius: 999, background: "var(--ink-2,#17130F)", overflow: "hidden", border: "1px solid var(--line)" }}>
                <div style={{ width: `${dayPct}%`, height: "100%", background: "linear-gradient(90deg,var(--ember-deep,#E8673A),var(--ember,#F0824E))", borderRadius: 999 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ash)", marginTop: 8 }}>
                <span>Day <b style={{ color: "var(--paper)" }}>{d.days ?? 0}</b> of {d.target ?? 60}</span>
                <span>{d.trades ?? 0} of {d.tradeTarget ?? 20} trades{(d.days ?? 0) === 0 ? " · not traded yet" : ""}</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ash)", marginTop: 14, lineHeight: 1.55, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                Real money only after it survives 60 paper days <b style={{ color: "var(--paper)" }}>and</b> you personally sign off. Backtests lie; the forward road is the honest judge.
              </div>
            </div>

            {/* POSITIONS */}
            <div style={{ ...card, gridColumn: "span 7" }}>
              <div style={lbl}>Positions · what the £5 is in</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {(d.holdings ?? []).slice(0, 3).map((h) => {
                  const up = (h.chg30 ?? 0) >= 0;
                  return (
                    <div key={h.ticker} style={{ background: "var(--ink-2,#17130F)", border: "1px solid var(--line)", borderRadius: 13, padding: 13 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontWeight: 800, fontSize: 17 }}>{h.ticker}</span>
                        {typeof h.price === "number" && <span style={{ color: "var(--ash)", fontSize: 13 }}>${h.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>}
                      </div>
                      {h.spark && <div style={{ margin: "8px 0 6px" }}><Spark vals={h.spark} up={up} /></div>}
                      {typeof h.chg30 === "number" && <span style={{ fontWeight: 800, fontSize: 13, color: up ? "var(--live,#5FD08A)" : "var(--c-err,#EF4444)" }}>{(h.chg30 * 100).toFixed(0)}% <span style={{ color: "var(--ash)", fontWeight: 500, fontSize: 11 }}>30d</span></span>}
                    </div>
                  );
                })}
                {!(d.holdings ?? []).length && <div style={{ color: "var(--ash)", fontSize: 13, gridColumn: "span 3" }}>Holdings appear after the next daily run.</div>}
              </div>
            </div>

            {/* MARKET */}
            <div style={{ ...card, gridColumn: "span 5" }}>
              <div style={lbl}>The market · well or shit</div>
              {d.breadth ? (
                <>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, fontWeight: 800, padding: "7px 13px", borderRadius: 999, background: "var(--ember-soft,rgba(240,130,78,.12))", color: "var(--ember,#F0824E)" }}>
                    {(d.breadth.regime ?? "—").toUpperCase()}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ash)", marginTop: 12 }}>{typeof d.breadth.pct_up === "number" ? `${d.breadth.pct_up.toFixed(0)}% of the S&P rising (30d)` : ""}{typeof d.breadth.avg30 === "number" ? ` · avg ${(d.breadth.avg30 * 100).toFixed(1)}%` : ""}</div>
                  {d.movers && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
                      {(d.movers.leaders ?? []).slice(0, 3).map((m) => <span key={m.ticker} style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 7, color: "var(--live,#5FD08A)", background: "rgba(95,208,138,.12)" }}>{m.ticker} {(m.chg30 * 100).toFixed(0)}%</span>)}
                      {(d.movers.laggards ?? []).slice(0, 3).map((m) => <span key={m.ticker} style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 7, color: "var(--c-err,#EF4444)", background: "rgba(239,68,68,.12)" }}>{m.ticker} {(m.chg30 * 100).toFixed(0)}%</span>)}
                    </div>
                  )}
                </>
              ) : <div style={{ color: "var(--ash)", fontSize: 13 }}>Market read appears after the daily run.</div>}
            </div>

            {/* LADDER */}
            <div style={{ ...card, gridColumn: "span 12" }}>
              <div style={lbl}>The ladder · each rung doubles</div>
              <div style={{ display: "flex", gap: 8 }}>
                {LADDER.map((v, i) => (
                  <div key={v} style={{ flex: 1, textAlign: "center", opacity: i > rungIdx ? .4 : 1 }}>
                    <div style={{ height: 6, borderRadius: 999, background: i <= rungIdx ? "var(--ember,#F0824E)" : "var(--line)" }} />
                    <div style={{ fontSize: 12.5, marginTop: 8, fontWeight: i === rungIdx ? 800 : 500, color: i === rungIdx ? "var(--paper)" : "var(--ash)" }}>£{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--ash)", marginTop: 12, textAlign: "center" }}>On rung {rungIdx} · double {gbp(d.equity)} → {gbp((LADDER[rungIdx] ?? 5) * 2)} to climb.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
