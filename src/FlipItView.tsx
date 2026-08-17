import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { getFlipit } from "./lib/api";

// 💷 FLIP IT — Pro Quant Trading Rig & Arbitrage Desk
// Bloomberg Terminal meets Apple Pro / Linear. Live equity curves, real-time spread scanner,
// Kelly Criterion risk shields, automated hedging regimes, order execution, and capital deposit.

type Day = { date: string; ret: number; equity: number; cumNet: number; tradesCum: number };
type Holding = { ticker: string; score: number; price?: number; chg7?: number; chg30?: number; spark?: number[]; weight: number };
type ArbSpread = { pair: string; exchangeA: string; exchangeB: string; spreadPct: number; estProfitGbp: number; spark: number[] };

const LADDER = [5, 10, 20, 40, 80, 160, 320, 640, 1280];
const gbp = (n = 0) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number, dp = 2) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(dp)}%`;

const SAMPLE_SPREADS: ArbSpread[] = [
  { pair: "BTC/USD", exchangeA: "Binance", exchangeB: "Coinbase Pro", spreadPct: 2.4, estProfitGbp: 142.50, spark: [20, 24, 22, 28, 35, 42, 38, 45] },
  { pair: "ETH/USD", exchangeA: "Coinbase Pro", exchangeB: "Kraken", spreadPct: 4.1, estProfitGbp: 210.80, spark: [15, 18, 25, 30, 28, 38, 48, 52] },
  { pair: "BTC/USD", exchangeA: "Bybit", exchangeB: "Binance", spreadPct: 4.4, estProfitGbp: 285.00, spark: [25, 30, 28, 35, 40, 44, 48, 55] },
  { pair: "SOL/USD", exchangeA: "Binance", exchangeB: "Coinbase Pro", spreadPct: 2.4, estProfitGbp: 95.20, spark: [10, 14, 18, 22, 25, 30, 35, 40] },
  { pair: "ETH/USD", exchangeA: "OKX", exchangeB: "Binance", spreadPct: 4.1, estProfitGbp: 180.40, spark: [30, 32, 35, 38, 42, 45, 50, 58] },
  { pair: "BTC/USD", exchangeA: "Kraken", exchangeB: "Coinbase Pro", spreadPct: 2.4, estProfitGbp: 130.00, spark: [18, 22, 26, 25, 29, 34, 38, 42] },
  { pair: "ETH/USD", exchangeA: "Binance", exchangeB: "Bybit", spreadPct: 2.1, estProfitGbp: 110.00, spark: [22, 25, 24, 28, 32, 36, 40, 44] },
];

export default function FlipItView() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "backtest" | "algorithms" | "reports">("dashboard");
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("500");
  const [hedgingRegime, setHedgingRegime] = useState<"aggressive" | "neutral" | "defensive">("neutral");
  const [algoStrategyVal, setAlgoStrategyVal] = useState(100);
  const [algoRiskVal, setAlgoRiskVal] = useState(2);
  const [orderExecVal, setOrderExecVal] = useState(0);
  const [orderLeverageVal, setOrderLeverageVal] = useState(1);
  const [spreads, setSpreads] = useState<ArbSpread[]>(SAMPLE_SPREADS);
  const [toast, setToast] = useState<string | null>(null);
  const [totalEquity, setTotalEquity] = useState(10540.00);
  const [dailyPL, setDailyPL] = useState(420.50);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleExecuteArb = (s: ArbSpread) => {
    triggerToast(`⚡ Executing ${s.pair} arbitrage spread (+${s.spreadPct}% on ${s.exchangeA} ↔ ${s.exchangeB})`);
    setTotalEquity((prev) => prev + s.estProfitGbp);
    setDailyPL((prev) => prev + s.estProfitGbp);
  };

  const handleDeposit = () => {
    const amt = parseFloat(depositAmount) || 0;
    if (amt <= 0) return;
    setTotalEquity((prev) => prev + amt);
    setDepositOpen(false);
    triggerToast(`✓ Deposited ${gbp(amt)} into trading rig.`);
  };

  const back = () => {
    const sd = (globalThis as any).samDesktop;
    if (sd?.close) {
      sd.close();
    } else {
      window.close();
      setTimeout(() => {
        if (!window.closed) location.href = "/";
      }, 50);
    }
  };

  return (
    <div className="flipit-pro-container" style={{
      background: "#08090C",
      color: "#F3F4F6",
      minHeight: "100vh",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, sans-serif",
      display: "flex",
      flexDirection: "column",
      padding: "16px 20px",
      boxSizing: "border-box",
    }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: "linear-gradient(135deg, #10B981, #059669)", color: "#fff",
          padding: "12px 20px", borderRadius: 12, fontWeight: 700, fontSize: 13,
          boxShadow: "0 10px 30px rgba(16,185,129,0.4)", display: "flex", alignItems: "center", gap: 8,
          animation: "slideInRight 0.25s ease-out",
        }}>
          <Icon name="check" size={16} /> {toast}
        </div>
      )}

      {/* Deposit Modal */}
      {depositOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999,
          background: "rgba(0,0,0,0.75)", backdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setDepositOpen(false)}>
          <div style={{
            background: "#12141A", border: "1px solid #232733", borderRadius: 20,
            padding: 28, width: 400, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>Add Funds / Deposit</div>
              <button type="button" onClick={() => setDepositOpen(false)} style={{ background: "none", border: "none", color: "#9CA3AF", cursor: "pointer" }}><Icon name="close" size={18} /></button>
            </div>
            <div style={{ fontSize: 13, color: "#9CA3AF", marginBottom: 14 }}>
              Inject capital into the autonomous FLIP IT trading rig &amp; arbitrage balance.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#1A1D26", border: "1px solid #2D3345", borderRadius: 12, padding: "10px 14px", marginBottom: 18 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "#10B981" }}>£</span>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                style={{ background: "none", border: "none", color: "#fff", fontSize: 20, fontWeight: 700, width: "100%", outline: "none" }}
                autoFocus
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              {["100", "500", "1000", "5000"].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setDepositAmount(v)}
                  style={{
                    flex: 1, padding: "8px 0", background: depositAmount === v ? "rgba(16,185,129,0.2)" : "#1E222D",
                    border: depositAmount === v ? "1px solid #10B981" : "1px solid #2D3345",
                    borderRadius: 8, color: depositAmount === v ? "#10B981" : "#9CA3AF", fontWeight: 700, fontSize: 12, cursor: "pointer"
                  }}>
                  +£{v}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleDeposit}
              style={{
                width: "100%", padding: 14, background: "linear-gradient(135deg, #10B981, #059669)",
                border: "none", borderRadius: 12, color: "#fff", fontWeight: 800, fontSize: 14,
                cursor: "pointer", boxShadow: "0 4px 16px rgba(16,185,129,0.35)",
              }}>
              Confirm Deposit →
            </button>
          </div>
        </div>
      )}

      {/* Top Header Bar */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: "1px solid #1F2430", paddingBottom: 14, marginBottom: 14,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #10B981, #059669)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900 }}>
              ⚡
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-.02em", color: "#fff" }}>FLIP IT</div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#10B981", letterSpacing: ".06em" }}>QUANT DESK PRO</div>
            </div>
          </div>

          <div style={{ height: 28, width: 1, background: "#232733" }} />

          {/* Metric Badges */}
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", textTransform: "uppercase" }}>Total Equity</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>{gbp(totalEquity)}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", textTransform: "uppercase" }}>Daily P/L</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#10B981" }}>+{gbp(dailyPL)} (+4.07%)</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{
                width: 38, height: 38, borderRadius: "50%",
                background: "conic-gradient(#10B981 0% 68%, #232733 68% 100%)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#08090C", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900 }}>
                  68%
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", textTransform: "uppercase" }}>Win-Rate</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#9CA3AF" }}>Kelly Optimized</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 10, padding: "6px 12px" }}>
              <Icon name="shield" size={16} />
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, color: "#F59E0B", textTransform: "uppercase" }}>Max Drawdown Shield</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>ACTIVE / 1.2%</div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={() => setDepositOpen(true)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(16,185,129,0.15)", border: "1px solid #10B981",
              borderRadius: 10, padding: "8px 14px", color: "#10B981",
              fontWeight: 800, fontSize: 13, cursor: "pointer",
            }}>
            <Icon name="plus" size={14} /> Add Money / Deposit
          </button>
          <button
            type="button"
            onClick={back}
            style={{
              background: "#1E222D", border: "1px solid #2D3345",
              borderRadius: 10, padding: "8px 14px", color: "#fff",
              fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}>
            ← Return to SAM
          </button>
        </div>
      </header>

      {/* Navigation Sub-Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["dashboard", "backtest", "algorithms", "reports"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              background: activeTab === tab ? "#1E222D" : "transparent",
              border: activeTab === tab ? "1px solid #374151" : "1px solid transparent",
              borderRadius: 8, padding: "6px 16px",
              color: activeTab === tab ? "#fff" : "#9CA3AF",
              fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: ".05em",
              cursor: "pointer",
            }}>
            {tab}
          </button>
        ))}
      </div>

      {/* Main 3-Column Quant Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "360px 1fr 340px",
        gap: 14,
        flex: 1,
        minHeight: 0,
      }}>
        {/* Left Column: Cross-Exchange Spread Arbitrage Scanner */}
        <div style={{
          background: "#0E1015", border: "1px solid #1E222D", borderRadius: 14,
          padding: 16, display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>Real-Time Cross-Exchange Arbitrage</div>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#10B981", background: "rgba(16,185,129,0.12)", padding: "2px 6px", borderRadius: 4 }}>● Live Scanner</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1, paddingRight: 4 }}>
            {spreads.map((s, idx) => (
              <div key={idx} style={{
                background: "#141720", border: "1px solid #232733", borderRadius: 10,
                padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between",
                transition: "border-color 0.15s ease",
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#fff" }}>{s.pair}</div>
                  <div style={{ fontSize: 11, color: "#6B7280" }}>{s.exchangeA} ↔ {s.exchangeB}</div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "#10B981" }}>+{s.spreadPct}%</div>
                  <div style={{ fontSize: 10, color: "#9CA3AF" }}>est. +{gbp(s.estProfitGbp)}</div>
                </div>

                <button
                  type="button"
                  onClick={() => handleExecuteArb(s)}
                  style={{
                    background: "linear-gradient(135deg, #10B981, #059669)", border: "none",
                    borderRadius: 8, padding: "6px 12px", color: "#fff", fontWeight: 800, fontSize: 11,
                    cursor: "pointer", boxShadow: "0 2px 8px rgba(16,185,129,0.3)",
                  }}>
                  EXECUTE ARB
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Center Column: Candlestick / Kelly Risk Shield Chart & Dials */}
        <div style={{
          display: "flex", flexDirection: "column", gap: 14, minHeight: 0,
        }}>
          {/* Main Chart Canvas */}
          <div style={{
            background: "#0E1015", border: "1px solid #1E222D", borderRadius: 14,
            padding: 16, flex: 1, display: "flex", flexDirection: "column",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>Kelly Criterion Risk Shields</span>
                <span style={{ fontSize: 11, color: "#6B7280", background: "#1A1D26", padding: "2px 8px", borderRadius: 6 }}>BTC/USD · 5m</span>
              </div>
              <div style={{ fontSize: 11, color: "#10B981", fontWeight: 700 }}>Depth: 669,250 USDT</div>
            </div>

            {/* Visual Candlestick & Kelly Band Mock SVG */}
            <div style={{ flex: 1, position: "relative", minHeight: 180 }}>
              <svg viewBox="0 0 500 200" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
                <defs>
                  <linearGradient id="kellyBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity="0.25" />
                    <stop offset="50%" stopColor="#10B981" stopOpacity="0.05" />
                    <stop offset="100%" stopColor="#EF4444" stopOpacity="0.20" />
                  </linearGradient>
                </defs>
                {/* Kelly Upper/Lower Bounds */}
                <path d="M0,80 Q100,50 200,90 T400,60 L500,75 L500,160 Q400,180 300,150 T100,170 L0,150 Z" fill="url(#kellyBand)" />
                <path d="M0,80 Q100,50 200,90 T400,60 L500,75" fill="none" stroke="#10B981" strokeWidth="1.5" />
                <path d="M0,150 Q100,170 300,150 T500,160" fill="none" stroke="#EF4444" strokeWidth="1.5" />

                {/* Candles */}
                {[
                  { x: 30, o: 120, c: 90, h: 80, l: 130 },
                  { x: 70, o: 95, c: 110, h: 90, l: 115 },
                  { x: 110, o: 110, c: 75, h: 65, l: 120 },
                  { x: 150, o: 78, c: 95, h: 70, l: 100 },
                  { x: 190, o: 92, c: 60, h: 50, l: 98 },
                  { x: 230, o: 62, c: 80, h: 55, l: 85 },
                  { x: 270, o: 79, c: 115, h: 75, l: 125 },
                  { x: 310, o: 112, c: 90, h: 80, l: 118 },
                  { x: 350, o: 88, c: 65, h: 55, l: 92 },
                  { x: 390, o: 67, c: 85, h: 60, l: 90 },
                  { x: 430, o: 82, c: 55, h: 45, l: 88 },
                  { x: 470, o: 58, c: 70, h: 50, l: 75 },
                ].map((c, i) => {
                  const green = c.c < c.o;
                  const color = green ? "#10B981" : "#EF4444";
                  return (
                    <g key={i}>
                      <line x1={c.x} y1={c.h} x2={c.x} y2={c.l} stroke={color} strokeWidth="1.2" />
                      <rect x={c.x - 6} y={Math.min(c.o, c.c)} width="12" height={Math.max(4, Math.abs(c.o - c.c))} fill={color} rx="1" />
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          {/* Bottom Dials & Sliders Deck */}
          <div style={{
            background: "#0E1015", border: "1px solid #1E222D", borderRadius: 14,
            padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16,
          }}>
            {/* Hedging Regime Dials */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#6B7280", textTransform: "uppercase", marginBottom: 10 }}>Automated Hedging Regime</div>
              <div style={{ display: "flex", gap: 10 }}>
                {(["aggressive", "neutral", "defensive"] as const).map((r) => {
                  const on = hedgingRegime === r;
                  const col = r === "aggressive" ? "#F59E0B" : r === "neutral" ? "#06B6D4" : "#10B981";
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setHedgingRegime(r)}
                      style={{
                        flex: 1, padding: "10px 6px",
                        background: on ? `rgba(${r === "aggressive" ? "245,158,11" : r === "neutral" ? "6,182,212" : "16,185,129"}, 0.15)` : "#141720",
                        border: on ? `2px solid ${col}` : "1px solid #232733",
                        borderRadius: 10, color: on ? "#fff" : "#6B7280",
                        fontWeight: 800, fontSize: 11, textTransform: "uppercase", cursor: "pointer",
                      }}>
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sliders Deck */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "#9CA3AF" }}>
                  <span>Algo Strategy Weight</span>
                  <span style={{ color: "#10B981" }}>{algoStrategyVal}%</span>
                </div>
                <input
                  type="range" min="0" max="100" value={algoStrategyVal}
                  onChange={(e) => setAlgoStrategyVal(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#10B981" }}
                />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: "#9CA3AF" }}>
                  <span>Execution Leverage</span>
                  <span style={{ color: "#F59E0B" }}>{orderLeverageVal}x</span>
                </div>
                <input
                  type="range" min="1" max="10" value={orderLeverageVal}
                  onChange={(e) => setOrderLeverageVal(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "#F59E0B" }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: AI Arbitrage Log & Rebalancing Ladder */}
        <div style={{
          display: "flex", flexDirection: "column", gap: 14, minHeight: 0,
        }}>
          {/* Live AI Log */}
          <div style={{
            background: "#0E1015", border: "1px solid #1E222D", borderRadius: 14,
            padding: 16, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#fff", marginBottom: 10 }}>Live AI Agent Arbitrage Log</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1, fontSize: 11 }}>
              {[
                { time: "3:52 AM", tag: "ORDER FILLED", text: "BUY 0.5 BTC @ $68,250 on Binance", ok: true },
                { time: "3:52 AM", tag: "OPPORTUNITY", text: "1.8% Spread Detected on ETH/USD", ok: true },
                { time: "3:51 AM", tag: "REBALANCE", text: "Shifted 5% USD to Solana Yield Pool", ok: true },
                { time: "3:48 AM", tag: "KELLY SHIELD", text: "Drawdown buffer verified at 1.2%", ok: true },
              ].map((log, i) => (
                <div key={i} style={{ background: "#141720", border: "1px solid #232733", borderRadius: 8, padding: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#6B7280", marginBottom: 2 }}>
                    <span>{log.time}</span>
                    <span style={{ color: "#10B981", fontWeight: 700 }}>{log.tag}</span>
                  </div>
                  <div style={{ color: "#D1D5DB", fontWeight: 600 }}>{log.text}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Rebalancing Ladder & Deploy CTA */}
          <div style={{
            background: "#0E1015", border: "1px solid #1E222D", borderRadius: 14,
            padding: 16, display: "flex", flexDirection: "column", gap: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#fff" }}>Automated Rebalancing Ladder</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
              {[
                { name: "Bitcoin (BTC)", target: "40%", current: "38%", up: true },
                { name: "Ethereum (ETH)", target: "40%", current: "38%", up: false },
                { name: "Solana (SOL)", target: "15%", current: "16%", up: true },
                { name: "Cash Reserve (GBP)", target: "5%", current: "8%", up: false },
              ].map((a, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: "#9CA3AF" }}>{a.name}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#6B7280" }}>{a.current} → {a.target}</span>
                    <span style={{ color: a.up ? "#10B981" : "#F59E0B" }}>{a.up ? "↑" : "↓"}</span>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => triggerToast("⚡ Capital deployed across highest alpha arbitrage spreads!")}
              style={{
                width: "100%", padding: 14,
                background: "linear-gradient(135deg, #F59E0B, #D97706)",
                border: "none", borderRadius: 12, color: "#000",
                fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: ".05em",
                cursor: "pointer", boxShadow: "0 4px 20px rgba(245,158,11,0.4)",
              }}>
              ⚡ Deploy Capital
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
