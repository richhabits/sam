import { useEffect, useState } from "react";
import { getFlipit } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// 💷 FLIP IT — SAM's £5 trading rig, surfaced read-only inside SAM. Reads the sibling ~/flip-it
// state via /api/flipit (loopback only). Absent on most machines → a short honest hint. Never trades.

type Rig = {
  present: boolean;
  equity?: number; rung?: number; hwm?: number; seeded?: boolean; status?: string | null;
  strategy?: string; targetVol?: number | null;
  days?: number; trades?: number; target?: number; tradeTarget?: number;
  holdings?: { ticker: string; price?: number; chg30?: number }[];
  breadth?: { pct_up?: number; regime?: string } | null;
};

const gbp = (n = 0) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FlipItPane({ onClose }: { onClose: () => void }) {
  useEscape(onClose);
  const [d, setD] = useState<Rig | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { getFlipit().then(setD).catch(() => setErr(true)); }, []);

  const dayPct = d?.present && d.target ? Math.min(100, ((d.days ?? 0) / d.target) * 100) : 0;
  const rungTarget = d?.present ? (d.equity ?? 0) : 0;   // display only

  return (
    <div className="drawer-wrap" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">💷 FLIP IT</div>
            <div className="drawer-sub">SAM's £5 trading rig — <b>read-only</b>. Nothing here trades; it just shows the live state.</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {err || (d && !d.present) ? (
          <div className="drawer-empty">
            FLIP IT isn't set up on this machine.<br />
            <span style={{ color: "var(--muted)", fontSize: 13 }}>It lives in <code>~/flip-it</code> (or set <code>FLIPIT_DIR</code>). It's Romeo's private £5 rig — not part of a normal SAM install.</span>
          </div>
        ) : !d ? (
          <div className="drawer-empty">Loading…</div>
        ) : (
          <div style={{ padding: "6px 20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Balance card */}
            <div style={{ borderRadius: 16, padding: 18, color: "#fff", background: "linear-gradient(135deg,#0b7a4b,#12a06f 55%,#16b79a)" }}>
              <div style={{ fontSize: 12.5, opacity: 0.9, display: "flex", justifyContent: "space-between" }}>
                <span>Balance</span><span>Rung {d.rung ?? 0}</span>
              </div>
              <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: "-.03em", marginTop: 2 }}>{gbp(d.equity)}</div>
              <div style={{ fontSize: 12, opacity: 0.88, marginTop: 4 }}>
                {d.strategy ?? "mom_12_1"}{typeof d.targetVol === "number" ? ` · ${(d.targetVol * 100).toFixed(0)}% vol` : ""} · high-water {gbp(d.hwm)}
              </div>
            </div>

            {/* Paper proof progress */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 8 }}>Paper proof</div>
              <div style={{ height: 7, borderRadius: 999, background: "var(--border-strong,#3D3226)", overflow: "hidden" }}>
                <div style={{ width: `${dayPct}%`, height: "100%", background: "var(--warn,#F59E0B)", borderRadius: 999 }} />
              </div>
              <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 6 }}>
                Day <b style={{ color: "var(--text)" }}>{d.days ?? 0}</b> of {d.target ?? 60} · {d.trades ?? 0} of {d.tradeTarget ?? 20} trades
                {(d.days ?? 0) === 0 ? " — not traded yet" : ""}
              </div>
            </div>

            {/* Holdings */}
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--muted)", marginBottom: 8 }}>What it trades</div>
              {(d.holdings ?? []).length ? (d.holdings ?? []).slice(0, 3).map((h, i) => (
                <div key={h.ticker} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontWeight: 700 }}>{h.ticker}</span>
                  <span style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                    {typeof h.price === "number" && <span style={{ color: "var(--muted)", fontSize: 13 }}>${h.price.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>}
                    {typeof h.chg30 === "number" && <span style={{ fontWeight: 700, fontSize: 13, color: h.chg30 >= 0 ? "var(--ok,#22C55E)" : "var(--err,#EF4444)" }}>{(h.chg30 * 100).toFixed(0)}% <span style={{ color: "var(--muted)", fontWeight: 500, fontSize: 11 }}>30d</span></span>}
                  </span>
                </div>
              )) : <div style={{ fontSize: 13, color: "var(--muted)" }}>Appears after the next daily run.</div>}
            </div>

            {/* Market */}
            {d.breadth && (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                Market: <b style={{ color: "var(--text)" }}>{(d.breadth.regime ?? "—").toUpperCase()}</b>
                {typeof d.breadth.pct_up === "number" ? ` · ${d.breadth.pct_up.toFixed(0)}% of the S&P rising (30d)` : ""}
              </div>
            )}

            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.55, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              Backtests lie, agents improvise, money amplifies both — so it proves on paper first. Real money only after it passes + you sign off.
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
