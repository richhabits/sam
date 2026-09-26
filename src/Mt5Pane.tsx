import { useEffect, useState } from "react";
import Icon from "./Icon";
import { getMt5Summary } from "./lib/api";
import { useEscape } from "./lib/useOverlay";

// MT5 — Phase 1: READ-ONLY view of account, open positions and journal metrics. There is
// deliberately nothing here that can place, modify or close a trade.

type Position = { ticket: string; symbol: string; side: "buy" | "sell"; volume: number; openPrice: number; currentPrice: number; profit: number };
type Summary = {
  backend: string; days: number; asOf?: string; stale?: boolean;
  account: { login: string; server: string; currency: string; balance: number; equity: number; margin: number; freeMargin: number; leverage: number; demo: boolean };
  positions: Position[];
  metrics: { trades: number; wins: number; losses: number; winRate: number; netProfit: number; profitFactor: number | null; expectancy: number; maxDrawdown: number; maxDrawdownPct: number; openPnl: number; marginUsedPct: number };
};

const fmt = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)}`;
const tone = (n: number) => ({ color: n > 0 ? "#3fa66b" : n < 0 ? "#d2553f" : undefined });

export default function Mt5Pane({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const [offline, setOffline] = useState("");      // not connected is a normal state, not an error
  useEscape(onClose);

  useEffect(() => {
    const load = () => getMt5Summary(30).then((r: any) => {
      if (r?.error) { setErr(r.error); setOffline(""); setS(null); }
      else if (r?.connected === false) { setErr(""); setOffline(r.reason || "MetaTrader 5 isn't connected."); setS(null); }
      else { setErr(""); setOffline(""); setS(r); }
    }).catch((e: any) => setErr(String(e?.message || e)));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const m = s?.metrics, a = s?.account;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by useEscape
    // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by useEscape
    <div className="drawer-wrap" onClick={onClose}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
      <aside className="drawer usage" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title"><Icon name="markets" size={19} /> MetaTrader 5</div>
            <div className="drawer-sub">{a ? `${a.demo ? "DEMO" : "LIVE"} · ${a.login} @ ${a.server} · ${s?.backend} · read-only` : "read-only"}</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>

        {err && <div className="drawer-empty">{err}</div>}
        {offline && (
          <div className="drawer-empty">
            <strong>Not connected.</strong> {offline}
            <br /><br />SAM only ever shows your real numbers — there is no sample data.
          </div>
        )}
        {!err && !offline && !s && <div className="drawer-empty">Loading…</div>}

        {s && a && m && (
          <>
            <div className="use-list">
              <div className="use-row">
                <div className="use-top"><span className="use-name">Balance</span><span className="use-count">{fmt(a.balance)} {a.currency}</span></div>
                <div className="use-top"><span className="use-name">Equity</span><span className="use-count">{fmt(a.equity)} {a.currency}</span></div>
                <div className="use-top"><span className="use-name">Open P/L</span><span className="use-count" style={tone(m.openPnl)}>{fmt(m.openPnl)}</span></div>
                <div className="use-meta">Margin {fmt(a.margin)} ({(m.marginUsedPct * 100).toFixed(1)}% of equity) · Free {fmt(a.freeMargin)} · 1:{a.leverage}</div>
              </div>

              <div className="use-row">
                <div className="use-top"><span className="use-name">Last {s.days} days</span><span className="use-count" style={tone(m.netProfit)}>{fmt(m.netProfit)}</span></div>
                <div className="use-meta">
                  {m.trades} trades · {m.wins}W/{m.losses}L · win rate {(m.winRate * 100).toFixed(1)}% · profit factor {m.profitFactor ?? "n/a"} · expectancy {fmt(m.expectancy)}/trade · max drawdown {fmt(m.maxDrawdown)} ({(m.maxDrawdownPct * 100).toFixed(1)}%)
                </div>
              </div>

              <div className="use-row">
                <div className="use-top"><span className="use-name">Open positions</span><span className="use-count">{s.positions.length}</span></div>
                {s.positions.length === 0 && <div className="use-meta">None.</div>}
                {s.positions.map((p) => (
                  <div key={p.ticket} className="use-top">
                    <span className="use-name">{p.symbol} {p.side.toUpperCase()} {p.volume}</span>
                    <span className="use-meta">{p.openPrice} → {p.currentPrice}</span>
                    <span className="use-count" style={tone(p.profit)}>{fmt(p.profit)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="use-foot">
              <Icon name="lock" size={14} /> Read-only. This view cannot place, change or close trades.{s.asOf ? ` Numbers as of ${s.asOf}${s.stale ? " — STALE: is MetaTrader 5 still running?" : ""}.` : ""}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
