import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { getFlipit } from "./lib/api";

// 💷 FLIP IT — Pro Quant Trading Rig & Arbitrage Desk
// Bloomberg Terminal meets Apple Pro / Linear. Live equity curves, real-time spread scanner,
// Kelly Criterion risk shields, automated hedging regimes, order execution, and capital deposit.

type Day = { date: string; ret: number; equity: number; cumNet: number; tradesCum: number };
type Holding = { ticker: string; score: number; price?: number; chg7?: number; chg30?: number; spark?: number[]; weight: number };
type ArbSpread = { pair: string; exchangeA: string; exchangeB: string; spreadPct: number; estProfitGbp: number; spark: number[] };
type EvSignal = {
  marketId: string;
  title: string;
  underlying: string;
  spotPriceUsd: number;
  strikePriceUsd: number;
  expiryDays: number;
  modelTrueProbability: number;
  marketImpliedProbability: number;
  edgePct: number;
  isPositiveEv: boolean;
  recommendedPosition: "BUY_YES" | "BUY_NO" | "PASS";
  halfKellyAllocationGbp: number;
  expectedRoiPct: number;
  confidenceScore: number;
  timestamp: number;
};

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
  const [activeNav, setActiveNav] = useState<string>("dashboard");
  const [paymentMethod, setPaymentMethod] = useState<"apple" | "visa" | "wire">("visa");
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState("500");
  const [hedgingRegime, setHedgingRegime] = useState<"aggressive" | "neutral" | "defensive">("neutral");
  const [algoVal1, setAlgoVal1] = useState(100);
  const [algoVal2, setAlgoVal2] = useState(2);
  const [orderVal1, setOrderVal1] = useState(0);
  const [orderVal2, setOrderVal2] = useState(1);
  const [spreads, setSpreads] = useState<ArbSpread[]>(() => {
    const saved = localStorage.getItem("flipit_spreads");
    return saved ? JSON.parse(saved) : SAMPLE_SPREADS;
  });
  const [toast, setToast] = useState<string | null>(null);
  const [totalEquity, setTotalEquity] = useState(() => {
    const saved = localStorage.getItem("flipit_equity");
    return saved ? parseFloat(saved) : 10540.00;
  });
  const [dailyPL, setDailyPL] = useState(() => {
    const saved = localStorage.getItem("flipit_dailyPL");
    return saved ? parseFloat(saved) : 420.50;
  });
  const [peakEquity, setPeakEquity] = useState(() => {
    const saved = localStorage.getItem("flipit_peakEquity");
    if (saved) return parseFloat(saved);
    const eq = localStorage.getItem("flipit_equity");
    return eq ? parseFloat(eq) : 10540.00;
  });
  const [shield, setShield] = useState<{
    winRatePct: number; drawdownPct: number; status: string; riskRegime: string;
  } | null>(null);
  const [evSignals, setEvSignals] = useState<EvSignal[]>([]);
  const [selectedScenario, setSelectedScenario] = useState<"etf" | "luna" | "covid" | "ftx">("etf");
  const [backtestRunning, setBacktestRunning] = useState(false);

  const [arbLogs, setArbLogs] = useState<{ time: string, tag: string, text: string, color: string }[]>(() => {
    const saved = localStorage.getItem("flipit_arbLogs");
    return saved ? JSON.parse(saved) : [
      { time: "3:52 AM", tag: "ORDER FILLED:", text: "BUY 0.5 BTC @ $68,250 on Binance", color: "var(--accent)" },
      { time: "3:32 AM", tag: "OPPORTUNITY FOUND:", text: "1.8% Spread Detected on ETH/USD", color: "var(--accent)" }
    ];
  });

  const [holdings, setHoldings] = useState<{ icon: string, name: string, target: string, current: string, up: boolean, col: string }[]>(() => {
    const saved = localStorage.getItem("flipit_holdings");
    return saved ? JSON.parse(saved) : [
      { icon: "₿", name: "BTC", target: "40%", current: "38%", up: true, col: "var(--accent)" },
      { icon: "Ξ", name: "ETH", target: "40%", current: "38%", up: true, col: "var(--accent)" },
      { icon: "⬡", name: "SOL", target: "20%", current: "24%", up: false, col: "var(--accent)" },
    ];
  });

  useEffect(() => {
    localStorage.setItem("flipit_arbLogs", JSON.stringify(arbLogs));
  }, [arbLogs]);

  useEffect(() => {
    localStorage.setItem("flipit_holdings", JSON.stringify(holdings));
  }, [holdings]);

  useEffect(() => {
    localStorage.setItem("flipit_spreads", JSON.stringify(spreads));
  }, [spreads]);

  useEffect(() => {
    localStorage.setItem("flipit_equity", totalEquity.toString());
  }, [totalEquity]);

  useEffect(() => {
    localStorage.setItem("flipit_dailyPL", dailyPL.toString());
  }, [dailyPL]);

  useEffect(() => {
    setPeakEquity((prev) => Math.max(prev, totalEquity));
  }, [totalEquity]);

  useEffect(() => {
    localStorage.setItem("flipit_peakEquity", peakEquity.toString());
  }, [peakEquity]);

  // Live Kelly risk shield from the backend. winRate is a fixed backtested-edge assumption
  // (this paper rig's /execute always fills, so there's no local loss history to derive it from);
  // avgWin/avgLoss are derived from the currently visible spread book at a ~1.8:1 payoff ratio.
  useEffect(() => {
    const avgWinGbp = spreads.length > 0
      ? spreads.reduce((sum, s) => sum + s.estProfitGbp, 0) / spreads.length
      : 150;
    const avgLossGbp = avgWinGbp * 0.55;
    fetch("/api/flipit/shield", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentEquityGbp: totalEquity,
        peakEquityGbp: Math.max(peakEquity, totalEquity),
        winRate: 0.68,
        avgWinGbp,
        avgLossGbp,
      }),
    })
      .then((res) => res.json())
      .then((data) => { if (!data?.error) setShield(data); })
      .catch(() => {
        // Backend unreachable — keep showing the last known shield values (or the ?? fallbacks).
      });
  }, [totalEquity, peakEquity, spreads]);

  const [d, setD] = useState<{ refused?: boolean } | null>(null);

  useEffect(() => {
    // Note: getFlipit() reads a separate, unrelated paper-trading rig's state — its `equity`
    // field must not overwrite this dashboard's own tracked totalEquity (flipit_equity).
    getFlipit()
      .then((data: any) => {
        setD(data);
      })
      .catch((e: any) => {
        if (e?.locked || e?.status === 401 || e?.status === 403) setD({ refused: true });
      });
  }, []);

  const triggerToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    fetch(`/api/flipit/signals?portfolio=${totalEquity}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.signals && Array.isArray(data.signals)) {
          setEvSignals(data.signals);
        }
      })
      .catch(() => {});
  }, [totalEquity, activeTab]);

  const handleExecuteEvSignal = async (sig: EvSignal) => {
    triggerToast(`⚡ Dispatching +EV ${sig.underlying} prediction stake...`);
    try {
      const res = await fetch("/api/flipit/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pair: `${sig.underlying}/USD`,
          spreadPct: sig.edgePct / 100,
          sellPrice: sig.spotPriceUsd,
          buyPrice: sig.strikePriceUsd,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const profit = Number((Math.max(15, sig.halfKellyAllocationGbp * (sig.expectedRoiPct / 100))).toFixed(2));
        triggerToast(`✓ +EV stake executed! Edge +${sig.edgePct.toFixed(1)}% secured.`);
        setTotalEquity((prev) => prev + profit);
        setDailyPL((prev) => prev + profit);

        const now = new Date();
        const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, "0")} ${now.getHours() >= 12 ? "PM" : "AM"}`;
        setArbLogs((prev) => [
          {
            time: timeStr,
            tag: "EV STAKE FILLED:",
            text: `${sig.recommendedPosition} ${sig.underlying} strike $${sig.strikePriceUsd.toLocaleString()} (+${sig.edgePct.toFixed(1)}% edge, +£${profit})`,
            color: "var(--accent)",
          },
          ...prev,
        ]);
        setEvSignals((prev) => prev.filter((s) => s.marketId !== sig.marketId));
      } else {
        triggerToast("⚠️ Stake rejected: " + (data.error || "Risk shield gate"));
      }
    } catch {
      triggerToast("⚠️ Execution network error.");
    }
  };

  useEffect(() => {
    // If returning from Stripe checkout
    const params = new URLSearchParams(window.location.search);
    if (params.get("deposit") === "success") {
      triggerToast("✓ Deposit successfully settled via Stripe!");
      window.history.replaceState({}, document.title, "/?app=flipit");
      const lastDeposit = parseFloat(localStorage.getItem("last_deposit") || "0");
      if (lastDeposit > 0) {
        setTotalEquity((prev) => prev + lastDeposit);
        localStorage.removeItem("last_deposit");
      }
    }
  }, []);

  const handleExecuteArb = async (s: ArbSpread) => {
    triggerToast(`⚡ Dispatching ${s.pair} execution to backend...`);
    try {
      const res = await fetch("/api/flipit/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadId: s.pair, estProfitGbp: s.estProfitGbp })
      });
      const data = await res.json();
      if (data.success) {
        triggerToast(`✓ Executed ${s.pair} arbitrage! +£${data.actualProfitGbp} secured.`);
        setTotalEquity((prev) => prev + data.actualProfitGbp);
        setDailyPL((prev) => prev + data.actualProfitGbp);
        
        // Make the mock dynamic: Remove the filled order from the order book!
        setSpreads((prev) => prev.filter(spread => spread !== s));

        // Make the mock dynamic: Add a real log entry!
        const now = new Date();
        const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')} ${now.getHours() >= 12 ? 'PM' : 'AM'}`;
        setArbLogs(prev => [{
          time: timeStr,
          tag: "ORDER FILLED:",
          text: `Arbitrage ${s.pair} spread captured for +£${data.actualProfitGbp}`,
          color: "var(--accent)"
        }, ...prev]);
      } else {
        triggerToast("⚠️ Execution failed: " + (data.error || "Slippage tolerance exceeded."));
      }
    } catch (e) {
      triggerToast("⚠️ Network error during execution.");
    }
  };

  const handleDeposit = async () => {
    const amt = parseFloat(depositAmount) || 0;
    if (amt <= 0) return;

    triggerToast("Redirecting to secure payment gateway...");
    localStorage.setItem("last_deposit", amt.toString());

    try {
      const res = await fetch("/api/flipit/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amt, paymentMethod })
      });
      const data = await res.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else if (data.error && data.error.includes("STRIPE_SECRET_KEY")) {
        triggerToast("⚠️ Stripe Key missing. Sign up at dashboard.stripe.com to enable live deposits.");
        setTimeout(() => window.open("https://dashboard.stripe.com/register", "_blank"), 2000);
      } else {
        triggerToast(data.error || "Failed to initialize checkout.");
      }
    } catch (err) {
      triggerToast("Network error connecting to payment gateway.");
    }
  };

  const handleRegimeChange = async (regime: "aggressive" | "neutral" | "defensive") => {
    setHedgingRegime(regime);
    triggerToast(`Retuning algorithms to ${regime.toUpperCase()}...`);
    
    try {
      await fetch("/api/flipit/hedging-regime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regime })
      });
      triggerToast(`✓ System re-tuned to ${regime.toUpperCase()} mode.`);
    } catch (err) {
      triggerToast("Failed to sync regime to backend.");
    }
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


  const handleKillSwitch = () => {
    triggerToast("⚡ EMERGENCY HALT INITIATED! Liquidating all open positions...");
    setTotalEquity(0);
    setTimeout(() => {
      triggerToast("All algorithmic trading halted. Portfolio flat.");
    }, 1500);
  };

  const SCENARIOS = {
    etf: {
      title: "2024 Bull Run (BTC ETF Inflows)",
      ret: "+182.4%",
      sharpe: "3.42",
      maxDd: "-6.8%",
      winRate: "74.2%",
      trades: 412,
      path: "M0,180 L40,170 L80,165 L120,140 L160,150 L200,120 L240,110 L280,80 L320,85 L360,60 L400,50 L440,30 L480,35 L520,20 L560,15 L600,25 L640,15 L680,10 L720,5 L760,12 L800,8",
      fill: "M0,180 L40,170 L80,165 L120,140 L160,150 L200,120 L240,110 L280,80 L320,85 L360,60 L400,50 L440,30 L480,35 L520,20 L560,15 L600,25 L640,15 L680,10 L720,5 L760,12 L800,8 L800,200 L0,200 Z",
    },
    luna: {
      title: "2022 Crypto Crash (LUNA / 3AC Collapse)",
      ret: "+24.1%",
      sharpe: "1.45",
      maxDd: "-14.2%",
      winRate: "58.0%",
      trades: 628,
      path: "M0,140 L50,130 L100,120 L150,160 L200,185 L250,175 L300,165 L350,150 L400,145 L450,135 L500,120 L550,110 L600,115 L650,95 L700,90 L750,80 L800,75",
      fill: "M0,140 L50,130 L100,120 L150,160 L200,185 L250,175 L300,165 L350,150 L400,145 L450,135 L500,120 L550,110 L600,115 L650,95 L700,90 L750,80 L800,75 L800,200 L0,200 Z",
    },
    covid: {
      title: "2020 COVID-19 Liquidity Shock & Rebound",
      ret: "+64.8%",
      sharpe: "2.12",
      maxDd: "-18.4%",
      winRate: "66.5%",
      trades: 284,
      path: "M0,120 L60,115 L120,110 L180,180 L240,190 L300,150 L360,130 L420,110 L480,90 L540,75 L600,60 L660,45 L720,40 L800,30",
      fill: "M0,120 L60,115 L120,110 L180,180 L240,190 L300,150 L360,130 L420,110 L480,90 L540,75 L600,60 L660,45 L720,40 L800,30 L800,200 L0,200 Z",
    },
    ftx: {
      title: "2022 FTX Bank Run & Alpha Recovery",
      ret: "+42.0%",
      sharpe: "2.65",
      maxDd: "-9.4%",
      winRate: "71.0%",
      trades: 310,
      path: "M0,150 L70,140 L140,130 L210,175 L280,160 L350,140 L420,120 L490,105 L560,90 L630,75 L700,65 L770,55 L800,50",
      fill: "M0,150 L70,140 L140,130 L210,175 L280,160 L350,140 L420,120 L490,105 L560,90 L630,75 L700,65 L770,55 L800,50 L800,200 L0,200 Z",
    },
  };

  const renderBacktestTab = () => {
    const sc = SCENARIOS[selectedScenario] || SCENARIOS.etf;
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, overflow: "hidden" }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div>
              <h2 style={{ fontSize: 16, color: "var(--text)", margin: 0, fontWeight: 900 }}>Historical Scenario Simulator</h2>
              <p style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 0 0" }}>Test Kelly Risk Shields and Arbitrage routing against historical crisis vectors.</p>
            </div>
            <span style={{ fontSize: 11, background: "rgba(255,255,255,0.06)", border: "1px solid var(--border)", padding: "4px 10px", borderRadius: 6, color: "var(--muted)" }}>
              Engine: Pure Deterministic Rust/C++
            </span>
          </div>

          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            <select
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value as any)}
              style={{ flex: 1, padding: "10px 14px", background: "#111", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, outline: "none", fontSize: 13, fontWeight: 600 }}>
              <option value="etf">2024 Bull Run (BTC ETF Approval & Inflows)</option>
              <option value="luna">2022 Crypto Crash (LUNA / 3AC Liquidation Cascade)</option>
              <option value="covid">2020 COVID-19 Flash Crash & Liquidity Squeeze</option>
              <option value="ftx">2022 FTX Bank Run & Market Maker Short Alpha</option>
            </select>
            <button
              onClick={() => {
                setBacktestRunning(true);
                triggerToast(`⏳ Running backtest across ${sc.title}...`);
                setTimeout(() => {
                  setBacktestRunning(false);
                  triggerToast(`✓ Backtest simulation complete: ${sc.ret} net gain (${sc.sharpe} Sharpe).`);
                }, 1000);
              }}
              style={{ padding: "0 24px", background: "var(--accent)", color: "#000", border: "none", borderRadius: 8, fontWeight: 800, cursor: "pointer", fontSize: 13 }}>
              {backtestRunning ? "Simulating..." : "Run Backtest →"}
            </button>
          </div>

          {/* Scenario Stats Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 16 }}>
            {[
              { label: "Net Simulated Return", val: sc.ret, col: "var(--accent)" },
              { label: "Sharpe Ratio", val: sc.sharpe, col: "var(--text)" },
              { label: "Max Drawdown", val: sc.maxDd, col: "#EF4444" },
              { label: "Win Rate", val: sc.winRate, col: "var(--text)" },
              { label: "Trades Executed", val: sc.trades.toString(), col: "var(--muted)" },
            ].map((stat, i) => (
              <div key={i} style={{ background: "#111", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 700 }}>{stat.label}</div>
                <div style={{ fontSize: 18, color: stat.col, fontWeight: 900, marginTop: 4 }}>{stat.val}</div>
              </div>
            ))}
          </div>

          <div style={{ height: 220, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", position: "relative", background: "#0A0A0A" }}>
            <svg viewBox="0 0 800 200" preserveAspectRatio="none" style={{ width: "100%", height: "100%", opacity: 0.9 }}>
              <title>{sc.title} equity curve</title>
              <defs>
                <linearGradient id="eqGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={sc.fill} fill="url(#eqGradient)" />
              <path d={sc.path} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
            </svg>
            <div style={{ position: "absolute", top: 16, left: 16 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase" }}>Strategy Return Vector</div>
              <div style={{ fontSize: 26, color: "var(--accent)", fontWeight: 900 }}>{sc.ret}</div>
            </div>
            <div style={{ position: "absolute", bottom: 12, right: 16, fontSize: 11, color: "var(--muted)" }}>
              {sc.title} · Benchmark Tested
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAlgorithmsTab = () => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
      {/* Active Logic Layers */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, color: "var(--text)", margin: 0, fontWeight: 900 }}>Active Autonomous Modules</h2>
          <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700 }}>● ALL SYSTEMS LIVE</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div style={{ background: "#111", border: "1px solid var(--border)", padding: 14, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--accent)", fontWeight: 800, fontSize: 11 }}>KELLY RISK SHIELD</span>
              <span style={{ color: "var(--accent)", fontSize: 10, fontWeight: 900 }}>{shield?.riskRegime || "BALANCED"}</span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.4, margin: 0 }}>
              Dynamic Kelly sizing f* = (pb - q)/b sizing at {pct(shield?.winRatePct ? (shield.winRatePct / 100) * 0.25 : 0.15, 1)} allocation.
            </p>
          </div>
          <div style={{ background: "#111", border: "1px solid var(--border)", padding: 14, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--accent)", fontWeight: 800, fontSize: 11 }}>CROSS-EXCHANGE ARB</span>
              <span style={{ color: "var(--accent)", fontSize: 10, fontWeight: 900 }}>&lt; 5ms</span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.4, margin: 0 }}>
              Scans Binance, Kraken, and Coinbase WebSocket books with 10bps spread floor.
            </p>
          </div>
          <div style={{ background: "#111", border: "1px solid var(--border)", padding: 14, borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--accent)", fontWeight: 800, fontSize: 11 }}>DELTA-NEUTRAL MM</span>
              <span style={{ color: "var(--accent)", fontSize: 10, fontWeight: 900 }}>HEDGED</span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.4, margin: 0 }}>
              Black-Scholes delta hedging on inventory with automated perpetual rebalancing.
            </p>
          </div>
        </div>
      </div>

      {/* Quantitative +EV Prediction Market Signals Scanner */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 18, flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 15, color: "var(--text)", margin: 0, fontWeight: 900 }}>Real-Time +EV Prediction Market Scanner</h2>
            <p style={{ color: "var(--muted)", fontSize: 11, margin: "2px 0 0 0" }}>Polymarket/Kalshi Orderbooks vs Black-Scholes Drift Model Probability</p>
          </div>
          <button
            onClick={() => {
              triggerToast("Scanning live orderbook probabilities...");
              fetch(`/api/flipit/signals?portfolio=${totalEquity}`)
                .then((r) => r.json())
                .then((d) => {
                  if (d?.signals) setEvSignals(d.signals);
                  triggerToast(`✓ Found ${d?.signals?.length || 0} +EV opportunities.`);
                });
            }}
            style={{ background: "rgba(255,255,255,0.08)", border: "1px solid var(--border)", color: "var(--text)", padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
            Refresh Signals ↻
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
          {evSignals.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12, border: "1px dashed var(--border)", borderRadius: 8 }}>
              No active prediction market anomalies above +5% edge threshold. Click Refresh to scan.
            </div>
          ) : (
            evSignals.map((sig) => (
              <div
                key={sig.marketId}
                style={{
                  background: "#111",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>{sig.title}</span>
                    <span style={{ fontSize: 10, background: "rgba(255,255,255,0.06)", padding: "2px 6px", borderRadius: 4, color: "var(--muted)" }}>
                      {sig.underlying} · {sig.expiryDays}d Exp
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                    <span>Spot: <strong style={{ color: "var(--text)" }}>${sig.spotPriceUsd.toLocaleString()}</strong></span>
                    <span>Strike: <strong style={{ color: "var(--text)" }}>${sig.strikePriceUsd.toLocaleString()}</strong></span>
                    <span>Market Implied: <strong style={{ color: "var(--text)" }}>{pct(sig.marketImpliedProbability, 1)}</strong></span>
                    <span>Model True: <strong style={{ color: "var(--accent)" }}>{pct(sig.modelTrueProbability, 1)}</strong></span>
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "var(--accent)" }}>
                    +{sig.edgePct.toFixed(1)}% EDGE
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    Half-Kelly: {gbp(sig.halfKellyAllocationGbp)}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleExecuteEvSignal(sig)}
                  style={{
                    background: sig.recommendedPosition === "BUY_YES" ? "linear-gradient(135deg, var(--accent), #059669)" : "#EF4444",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 14px",
                    color: "#000",
                    fontWeight: 900,
                    fontSize: 11,
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                  }}>
                  {sig.recommendedPosition === "BUY_YES" ? "BUY YES →" : "BUY NO →"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderReportsTab = () => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { label: "Portfolio Equity", val: gbp(totalEquity), col: "var(--text)" },
          { label: "Sharpe Ratio", val: "2.84", col: "var(--accent)" },
          { label: "Risk Regime", val: shield?.riskRegime || "BALANCED", col: "var(--accent)" },
          { label: "Win Rate (Trailing)", val: `${shield?.winRatePct ? shield.winRatePct.toFixed(1) : "68.0"}%`, col: "var(--text)" },
        ].map((stat, i) => (
          <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", fontWeight: 800, marginBottom: 8 }}>{stat.label}</div>
            <div style={{ fontSize: 24, color: stat.col, fontWeight: 900 }}>{stat.val}</div>
          </div>
        ))}
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, flex: 1, display: "flex", flexDirection: "column" }}>
        <h2 style={{ fontSize: 16, color: "var(--text)", marginTop: 0, marginBottom: 16, fontWeight: 900 }}>Monthly Performance Alpha Breakdown</h2>
        <div style={{ height: "100%", minHeight: 200, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "16px 24px", background: "#0A0A0A" }}>
          {[40, 60, -20, 80, 50, -10, 90, 70].map((h, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: "100%" }}>
              <div style={{ height: 120, width: "100%", position: "relative", display: "flex", alignItems: h > 0 ? "flex-end" : "flex-start", justifyContent: "center" }}>
                <div style={{ position: "absolute", top: "50%", width: "120%", height: 1, background: "var(--border)" }}></div>
                <div style={{
                  width: "60%",
                  height: `${Math.abs(h)}%`,
                  background: h > 0 ? "linear-gradient(180deg, var(--accent), rgba(16,185,129,0.5))" : "linear-gradient(180deg, rgba(239,68,68,0.5), #EF4444)",
                  borderRadius: 4,
                  marginTop: h < 0 ? "50%" : 0,
                  marginBottom: h > 0 ? "50%" : 0,
                  zIndex: 1
                }}></div>
              </div>
              <span style={{ fontSize: 10, color: "var(--muted)" }}>M{i+1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSettingsModule = () => (
    <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
      <h1 style={{ fontSize: 28, color: "var(--text)", marginTop: 0, fontWeight: 900, letterSpacing: "-.02em" }}>Platform Settings</h1>
      <div style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: 24 }}>
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 24 }}>
          <h2 style={{ fontSize: 14, color: "var(--muted)", marginTop: 0, textTransform: "uppercase", fontWeight: 800 }}>Real Market Integrations</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
            {[
              { name: "Binance API (Spot/Margin)", url: "https://www.binance.com/en/register", color: "#FCD535", textCol: "#000" },
              { name: "Stripe Billing (Deposits)", url: "https://dashboard.stripe.com/register", color: "#635BFF", textCol: "#FFF" },
              { name: "Kraken Pro (Arbitrage)", url: "https://pro.kraken.com/app/onboarding", color: "#5841D8", textCol: "#FFF" },
              { name: "Polymarket (+EV Signals)", url: "https://polymarket.com/signup", color: "#0055FF", textCol: "#FFF" },
              { name: "Kalshi (US Regulated)", url: "https://kalshi.com/sign-up", color: "#000000", textCol: "#FFF", border: "1px solid #333" }
            ].map((api, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", padding: "12px 16px", borderRadius: 8 }}>
                <span style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>{api.name}</span>
                <button 
                  onClick={() => window.open(api.url, "_blank")}
                  style={{ background: api.color, border: api.border || "none", color: api.textCol, padding: "6px 14px", borderRadius: 6, fontSize: 11, fontWeight: 900, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}>
                  SIGN UP / LINK ↗
                </button>
              </div>
            ))}
          </div>
        </section>
        
        <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 24 }}>
          <h2 style={{ fontSize: 14, color: "var(--muted)", marginTop: 0, textTransform: "uppercase", fontWeight: 800 }}>Global Risk Limits</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text)", marginBottom: 8 }}>
                <span>Max Drawdown Limit</span>
                <span style={{ color: "var(--accent)", fontWeight: 800 }}>5.0%</span>
              </div>
              <input type="range" min="1" max="20" defaultValue="5" style={{ width: "100%", accentColor: "var(--accent)" }} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  const renderLayersModule = () => (
    <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
      <h1 style={{ fontSize: 28, color: "var(--text)", marginTop: 0, fontWeight: 900, letterSpacing: "-.02em", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--accent)", display: "inline-flex" }}><Icon name="sparkle" size={24} /></span> Strategy Composer
      </h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>Stack and weight execution algorithms dynamically.</p>
      
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        {[{ name: "Kelly Kelly Arbitrage", weight: 60, col: "var(--accent)" }, { name: "Momentum RSI Reversion", weight: 25, col: "var(--accent)" }, { name: "Orderbook Imbalance", weight: 15, col: "var(--accent)" }].map((layer, i) => (
          <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 800, marginBottom: 16 }}>{layer.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <input type="range" value={layer.weight} style={{ flex: 1, accentColor: layer.col }} readOnly />
              <span style={{ color: layer.col, fontWeight: 900, fontSize: 14 }}>{layer.weight}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderTeamModule = () => (
    <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
      <h1 style={{ fontSize: 28, color: "var(--text)", marginTop: 0, fontWeight: 900, letterSpacing: "-.02em", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--accent)", display: "inline-flex" }}><Icon name="globe" size={24} /></span> Swarm Topology
      </h1>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, marginTop: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[ { node: "AWS-USEAST-1", role: "Arb Scanner", ping: "12ms", status: "ACTIVE", col: "var(--accent)" }, { node: "GCP-EUR-3", role: "Execution Engine", ping: "45ms", status: "ACTIVE", col: "var(--accent)" }, { node: "LOCAL-MAC", role: "Risk Manager", ping: "1ms", status: "STANDBY", col: "var(--accent)" } ].map((node, i) => (
             <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", padding: "16px 20px", borderRadius: 8 }}>
               <div>
                 <div style={{ color: "var(--text)", fontWeight: 800, fontSize: 14 }}>{node.node}</div>
                 <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>Role: {node.role}</div>
               </div>
               <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                 <div style={{ color: "var(--muted)", fontSize: 12 }}>Ping: {node.ping}</div>
                 <div style={{ background: `${node.col}22`, color: node.col, padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 900 }}>{node.status}</div>
               </div>
             </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderDocsModule = () => (
    <div style={{ flex: 1, padding: 24, overflow: "auto" }}>
      <h1 style={{ fontSize: 28, color: "var(--text)", marginTop: 0, fontWeight: 900, letterSpacing: "-.02em", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ color: "var(--text)", display: "inline-flex" }}><Icon name="folder" size={24} /></span> Compliance & Docs
      </h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 24 }}>
        {[ "2026 Q2 Tax Export (CSV)", "AML / KYC Ledger Verification", "Trade Log (Binance) - Last 30 Days", "Platform Security Audit Report" ].map((doc, i) => (
          <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#CBD5E1", fontSize: 13, fontWeight: 700 }}>{doc}</span>
            <button 
              onClick={() => triggerToast(`✓ Exporting ${doc}...`)}
              style={{ background: "var(--border)", border: "none", color: "var(--text)", padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 800 }}>Download</button>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100vw",
      background: "#080C13",
      color: "var(--text)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif",
      overflow: "hidden",
      userSelect: "none",
    }}>
      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          background: "linear-gradient(135deg, var(--accent), #059669)", color: "var(--text)",
          padding: "12px 20px", borderRadius: 12, fontWeight: 700, fontSize: 13,
          boxShadow: "0 10px 30px rgba(16,185,129,0.4)", display: "flex", alignItems: "center", gap: 8,
        }}>
          <Icon name="check" size={16} /> {toast}
        </div>
      )}

      {/* Deposit Modal */}
      {depositOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 999,
          background: "rgba(0,0,0,0.8)", backdropFilter: "blur(12px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setDepositOpen(false)}>
          <div style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20,
            padding: 28, width: 400, maxWidth: "90vw", boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>Add Funds / Deposit</div>
              <button type="button" onClick={() => setDepositOpen(false)} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer" }}><Icon name="close" size={18} /></button>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 14 }}>
              Inject capital into the FLIP IT trading rig & arbitrage balance.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#161D2C", border: "1px solid #283548", borderRadius: 12, padding: "10px 14px", marginBottom: 18 }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: "var(--accent)" }}>£</span>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                style={{ background: "none", border: "none", color: "var(--text)", fontSize: 20, fontWeight: 700, width: "100%", outline: "none" }}
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
                    flex: 1, padding: "8px 0", background: depositAmount === v ? "rgba(16,185,129,0.2)" : "#161D2C",
                    border: depositAmount === v ? "1px solid var(--accent)" : "1px solid #283548",
                    borderRadius: 8, color: depositAmount === v ? "var(--accent)" : "var(--muted)", fontWeight: 700, fontSize: 12, cursor: "pointer"
                  }}>
                  +£{v}
                </button>
              ))}
            </div>

            <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 10, fontWeight: 700 }}>Payment Method</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
              <button type="button" onClick={() => setPaymentMethod("visa")} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 0", background: paymentMethod === "visa" ? "rgba(6,182,212,0.15)" : "#161D2C", border: paymentMethod === "visa" ? "1px solid var(--accent)" : "1px solid #283548", borderRadius: 10, cursor: "pointer" }}>
                <span style={{ fontSize: 18 }}>💳</span>
                <span style={{ fontSize: 11, color: paymentMethod === "visa" ? "var(--accent)" : "var(--muted)", fontWeight: 700 }}>Visa •••• 4242</span>
              </button>
              <button type="button" onClick={() => setPaymentMethod("apple")} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 0", background: paymentMethod === "apple" ? "rgba(255,255,255,0.1)" : "#161D2C", border: paymentMethod === "apple" ? "1px solid var(--text)" : "1px solid #283548", borderRadius: 10, cursor: "pointer" }}>
                <span style={{ fontSize: 18 }}></span>
                <span style={{ fontSize: 11, color: paymentMethod === "apple" ? "var(--text)" : "var(--muted)", fontWeight: 700 }}>Apple Pay</span>
              </button>
              <button type="button" onClick={() => setPaymentMethod("wire")} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 0", background: paymentMethod === "wire" ? "rgba(245,158,11,0.15)" : "#161D2C", border: paymentMethod === "wire" ? "1px solid var(--accent)" : "1px solid #283548", borderRadius: 10, cursor: "pointer" }}>
                <span style={{ fontSize: 18 }}>🏦</span>
                <span style={{ fontSize: 11, color: paymentMethod === "wire" ? "var(--accent)" : "var(--muted)", fontWeight: 700 }}>Wire Transfer</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDeposit}
              style={{
                width: "100%", padding: 14, background: "linear-gradient(135deg, var(--accent), #059669)",
                border: "none", borderRadius: 12, color: "var(--text)", fontWeight: 800, fontSize: 14,
                cursor: "pointer", boxShadow: "0 4px 16px rgba(16,185,129,0.35)",
              }}>
              Authorize {paymentMethod === "visa" ? "Card" : paymentMethod === "apple" ? "Apple Pay" : "Wire"} Deposit →
            </button>
          </div>
        </div>
      )}

      {/* ── Left Vertical Navigation Rail (Matching Mockup 1) ── */}
      <aside style={{
        width: 60,
        background: "#06080E",
        borderRight: "1px solid #131926",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 0",
        gap: 16,
        zIndex: 10,
      }}>
        {/* Diamond SAM Logo */}
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: "linear-gradient(135deg, var(--accent), var(--accent))",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--text)", fontWeight: 900, fontSize: 18, marginBottom: 8,
          boxShadow: "0 0 16px rgba(6,182,212,0.4)",
        }}>
          ⚡
        </div>

        {/* Navigation Action Icons */}
        {[
          { id: "dashboard", icon: "grid", label: "Dashboard" },
          { id: "chart", icon: "activity", label: "Chart" },
          { id: "settings", icon: "settings", label: "Settings" },
          { id: "layers", icon: "sparkle", label: "Layers" },
          { id: "team", icon: "globe", label: "Swarm" },
          { id: "docs", icon: "folder", label: "Logs" },
        ].map((btn) => (
          <button
            key={btn.id}
            type="button"
            onClick={() => setActiveNav(btn.id)}
            title={btn.label}
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: activeNav === btn.id ? "rgba(6,182,212,0.18)" : "transparent",
              border: activeNav === btn.id ? "1px solid var(--accent)" : "1px solid transparent",
              color: activeNav === btn.id ? "var(--accent)" : "var(--muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", transition: "all 0.15s ease",
            }}>
            <Icon name={btn.icon as any} size={18} />
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {/* Bottom utility icons */}
        <button
          type="button"
          onClick={() => triggerToast("Help & Docs: Automated Kelly Arbitrage v3.4")}
          style={{ width: 40, height: 40, borderRadius: 10, background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="search" size={18} />
        </button>
        <button
          type="button"
          onClick={back}
          title="Return to SAM"
          style={{ width: 40, height: 40, borderRadius: 10, background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="close" size={18} />
        </button>
      </aside>

      {/* ── Main Trading Desk Content Area ── */}
      <main style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: "radial-gradient(ellipse at 80% -20%, rgba(6,182,212,0.06), transparent 60%), #080C13",
        overflow: "hidden"
      }}>
        {/* FCA Regulatory Compliance Banner */}
        <div style={{
          width: "100%", background: "#1E1B4B", borderBottom: "1px solid #312E81",
          padding: "6px 16px", display: "flex", justifyContent: "space-between", alignItems: "center",
          fontSize: 11, color: "#818CF8", fontWeight: 600, zIndex: 50
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>🏛️</span>
            <span><strong>FCA COMPLIANCE PENDING:</strong> FlipIt is operating in Simulated Beta Mode. No real fiat is currently custodied. Partnering with ZeroHash and ClearBank.</span>
          </div>
          <button
            type="button"
            onClick={() => triggerToast("Opening Legal Disclaimers...")}
            style={{ background: "none", border: "none", padding: 0, margin: 0, font: "inherit", color: "#A5B4FC", textDecoration: "underline", cursor: "pointer" }}>
            View Legal Stack
          </button>
        </div>

        {/* Top Stats Header */}
        <header style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid #131926",
          paddingBottom: 12,
          marginBottom: 10,
        }}>
          {/* Logo & Total Equity */}
          <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "-.02em", color: "var(--accent)", textShadow: "0 0 12px rgba(6,182,212,0.4)" }}>
                FLIP IT
              </div>
            </div>

            <div style={{ height: 26, width: 1, background: "var(--border)" }} />

            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>Total Equity</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{gbp(totalEquity)}</div>
            </div>

            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>Daily P/L</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}>+{gbp(dailyPL)} (+4.07%)</div>
            </div>

            {/* Circular Win Rate Gauge */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                position: "relative", width: 42, height: 42, borderRadius: "50%",
                background: `conic-gradient(var(--accent) 0% ${shield?.winRatePct ?? 68}%, var(--border) ${shield?.winRatePct ?? 68}% 100%)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 12px rgba(16,185,129,0.3)",
              }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#080C13", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, color: "var(--text)" }}>
                  {Math.round(shield?.winRatePct ?? 68)}%
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>Win-Rate</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: shield?.status === "DRAWDOWN_HALT" ? "#EF4444" : "var(--accent)" }}>
                  {shield?.status === "DRAWDOWN_HALT" ? "Halted" : shield?.status === "INSUFFICIENT_DATA" ? "Calibrating" : "Optimized"}
                </div>
              </div>
            </div>

            {/* Max Drawdown Shield */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 10, padding: "6px 14px",
            }}>
              <div style={{ fontSize: 18, color: "var(--accent)" }}>🛡️</div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, color: "var(--accent)", textTransform: "uppercase" }}>Max Drawdown Shield</div>
                <div style={{ fontSize: 12, fontWeight: 900, color: shield?.status === "DRAWDOWN_HALT" ? "#EF4444" : "var(--accent)" }}>
                  {shield?.status === "DRAWDOWN_HALT" ? "HALTED" : "ACTIVE"} / {(shield?.drawdownPct ?? 1.2).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Deposit & Return Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              type="button"
              onClick={() => setDepositOpen(true)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "linear-gradient(135deg, var(--accent), #059669)", border: "none",
                borderRadius: 10, padding: "8px 16px", color: "var(--text)",
                fontWeight: 800, fontSize: 12, cursor: "pointer",
                boxShadow: "0 2px 10px rgba(16,185,129,0.3)",
              }}>
              <Icon name="plus" size={14} /> Add Money / Deposit
            </button>
          </div>
        </header>

        {/* Sub Navigation Tabs */}
        <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
          {(["dashboard", "backtest", "algorithms", "reports"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              style={{
                background: "none",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
                padding: "6px 0",
                color: activeTab === tab ? "var(--accent)" : "var(--muted)",
                fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em",
                cursor: "pointer",
              }}>
              {tab}
            </button>
          ))}
        </div>

        {/* ── Dynamic Main View Router ── */}
        {activeNav === "settings" ? renderSettingsModule() :
         activeNav === "layers" ? renderLayersModule() :
         activeNav === "team" ? renderTeamModule() :
         activeNav === "folder" ? renderDocsModule() :
         activeTab === "backtest" ? renderBacktestTab() :
         activeTab === "algorithms" ? renderAlgorithmsTab() :
         activeTab === "reports" ? renderReportsTab() :
         (
        <div style={{
          display: "grid",
          gridTemplateColumns: "360px 1fr 340px",
          gap: 14,
          flex: 1,
          minHeight: 0,
        }}>
          {/* Left Column: Real-Time Cross-Exchange Spread Arbitrage Scanner */}
          <section style={{
            background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
            padding: "14px 16px", display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
                Real-Time Cross-Exchange Spread Arbitrage Scanner
              </div>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>•••</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 700, color: "var(--muted)", paddingBottom: 6, borderBottom: "1px solid #131926", textTransform: "uppercase" }}>
              <span>Pair ⇅</span>
              <span>Spread %</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1, paddingTop: 6, paddingRight: 4 }}>
              {spreads.map((s, idx) => (
                <div key={idx} style={{
                  background: "var(--surface)", border: "1px solid var(--surface)", borderRadius: 8,
                  padding: "8px 10px", display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>{s.pair}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>{s.exchangeA}</div>
                  </div>

                  {/* Sparkline mini */}
                  <div style={{ width: 44, height: 18 }}>
                    <svg viewBox="0 0 44 18" style={{ width: "100%", height: "100%" }}>
                      <title>{s.pair} spread trend</title>
                      <polyline points="0,14 10,12 20,15 30,8 44,4" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>

                  <div style={{
                    background: "rgba(6,182,212,0.12)", border: "1px solid rgba(6,182,212,0.25)",
                    borderRadius: 6, padding: "2px 8px", color: "var(--accent)", fontSize: 11, fontWeight: 800,
                  }}>
                    +{s.spreadPct}%
                  </div>

                  <button
                    type="button"
                    onClick={() => handleExecuteArb(s)}
                    style={{
                      background: "linear-gradient(135deg, var(--accent), #059669)", border: "none",
                      borderRadius: 6, padding: "4px 10px", color: "var(--text)", fontWeight: 800, fontSize: 10,
                      cursor: "pointer", boxShadow: "0 2px 6px rgba(16,185,129,0.3)",
                    }}>
                    EXECUTE ARB
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Center Column: Kelly Candlestick Chart, Circular Hedging Dials, Sliders */}
          <section style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
            {/* Kelly Criterion Risk Shields Chart */}
            <div style={{
              background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
              padding: "14px 16px", flex: 1, display: "flex", flexDirection: "column",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Kelly Criterion Risk Shields</span>
                  <span style={{ fontSize: 10, color: "var(--accent)", background: "rgba(6,182,212,0.1)", padding: "2px 6px", borderRadius: 4 }}>BTC/USD · 5m</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>Depth: 668,250</div>
              </div>

              {/* Candlestick & Kelly Envelope SVG */}
              <div style={{ flex: 1, position: "relative", minHeight: 160 }}>
                <svg viewBox="0 0 500 180" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
                  <title>Kelly criterion risk envelope with recent candlesticks</title>
                  <defs>
                    <linearGradient id="kellyGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                      <stop offset="50%" stopColor="var(--accent)" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.2" />
                    </linearGradient>
                  </defs>
                  {/* Kelly Bounds */}
                  <path d="M0,70 Q120,40 240,80 T480,50 L500,60 L500,150 Q360,170 240,140 T0,160 Z" fill="url(#kellyGlow)" />
                  <path d="M0,70 Q120,40 240,80 T500,60" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
                  <path d="M0,160 Q120,140 240,140 T500,150" fill="none" stroke="var(--accent)" strokeWidth="1.5" />

                  {/* Candlesticks */}
                  {[
                    { x: 30, o: 110, c: 80, h: 70, l: 120 },
                    { x: 70, o: 85, c: 100, h: 80, l: 105 },
                    { x: 110, o: 100, c: 65, h: 55, l: 110 },
                    { x: 150, o: 68, c: 85, h: 60, l: 90 },
                    { x: 190, o: 82, c: 50, h: 40, l: 88 },
                    { x: 230, o: 52, c: 70, h: 45, l: 75 },
                    { x: 270, o: 69, c: 105, h: 65, l: 115 },
                    { x: 310, o: 102, c: 80, h: 70, l: 108 },
                    { x: 350, o: 78, c: 55, h: 45, l: 82 },
                    { x: 390, o: 57, c: 75, h: 50, l: 80 },
                    { x: 430, o: 72, c: 45, h: 35, l: 78 },
                    { x: 470, o: 48, c: 60, h: 40, l: 65 },
                  ].map((c, i) => {
                    const green = c.c < c.o;
                    const color = green ? "var(--accent)" : "#EF4444";
                    return (
                      <g key={i}>
                        <line x1={c.x} y1={c.h} x2={c.x} y2={c.l} stroke={color} strokeWidth="1.2" />
                        <rect x={c.x - 5} y={Math.min(c.o, c.c)} width="10" height={Math.max(4, Math.abs(c.o - c.c))} fill={color} rx="1" />
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* AUTOMATED HEDGING REGIME — 3 Glowing Circular Dials (Matching Mockup 1) */}
            <div className="flipit-card">
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", textAlign: "center", marginBottom: 12 }}>
                AUTOMATED HEDGING REGIME
              </div>

              <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
                {/* AGGRESSIVE Dial (Orange) */}
                <button
                  type="button"
                  onClick={() => handleRegimeChange("aggressive")}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    opacity: hedgingRegime === "aggressive" ? 1 : 0.45,
                    transform: hedgingRegime === "aggressive" ? "scale(1.05)" : "scale(1)",
                    transition: "all 0.2s ease",
                  }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: "50%",
                    border: "3px solid var(--accent)",
                    boxShadow: hedgingRegime === "aggressive" ? "0 0 20px rgba(245,158,11,0.5), inset 0 0 15px rgba(245,158,11,0.3)" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, color: "var(--accent)",
                  }}>
                    ✈️
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 900, color: "var(--accent)", letterSpacing: ".06em" }}>AGGRESSIVE</span>
                </button>

                {/* NEUTRAL Dial (Cyan Glowing Arc) */}
                <button
                  type="button"
                  onClick={() => handleRegimeChange("neutral")}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    opacity: hedgingRegime === "neutral" ? 1 : 0.45,
                    transform: hedgingRegime === "neutral" ? "scale(1.08)" : "scale(1)",
                    transition: "all 0.2s ease",
                  }}>
                  <div style={{
                    width: 84, height: 84, borderRadius: "50%",
                    border: "4px solid var(--accent)",
                    boxShadow: hedgingRegime === "neutral" ? "0 0 28px rgba(6,182,212,0.6), inset 0 0 20px rgba(6,182,212,0.3)" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: 900, color: "var(--accent)", letterSpacing: ".08em",
                  }}>
                    NEUTRAL
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 900, color: "var(--accent)", letterSpacing: ".06em" }}>NEUTRAL</span>
                </button>

                {/* DEFENSIVE Dial (Green Shield) */}
                <button
                  type="button"
                  onClick={() => handleRegimeChange("defensive")}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    opacity: hedgingRegime === "defensive" ? 1 : 0.45,
                    transform: hedgingRegime === "defensive" ? "scale(1.05)" : "scale(1)",
                    transition: "all 0.2s ease",
                  }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: "50%",
                    border: "3px solid var(--accent)",
                    boxShadow: hedgingRegime === "defensive" ? "0 0 20px rgba(16,185,129,0.5), inset 0 0 15px rgba(16,185,129,0.3)" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, color: "var(--accent)",
                  }}>
                    🛡️
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 900, color: "var(--accent)", letterSpacing: ".06em" }}>DEFENSIVE</span>
                </button>
              </div>
            </div>

            {/* Sliders Deck: ALGO STRATEGY & ORDER EXECUTION (Matching Mockup 1) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {/* ALGO STRATEGY Card */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>ALGO STRATEGY</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <input type="range" min="0" max="100" value={algoVal1} onChange={(e) => setAlgoVal1(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)", background: "#0F172A", padding: "2px 8px", borderRadius: 6 }}>{algoVal1} +</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="range" min="1" max="10" value={algoVal2} onChange={(e) => setAlgoVal2(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)", background: "#0F172A", padding: "2px 8px", borderRadius: 6 }}>{algoVal2} +</span>
                </div>
              </div>

              {/* ORDER EXECUTION Card */}
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "10px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginBottom: 8 }}>ORDER EXECUTION</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <input type="range" min="0" max="10" value={orderVal1} onChange={(e) => setOrderVal1(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)", background: "#0F172A", padding: "2px 8px", borderRadius: 6 }}>{orderVal1} +</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="range" min="1" max="10" value={orderVal2} onChange={(e) => setOrderVal2(Number(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)", background: "#0F172A", padding: "2px 8px", borderRadius: 6 }}>{orderVal2} +</span>
                </div>
              </div>
            </div>
          </section>

          {/* Right Column: AI Log, Rebalancing Ladder, Master Deploy CTA */}
          <section style={{ display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
            {/* Live AI Agent Arbitrage Log */}
            <div className="flipit-card" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Live AI Agent Arbitrage Log</div>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>•••</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", flex: 1, fontSize: 11 }}>
                {arbLogs.map((log, i) => (
                  <div key={i} style={{ background: "var(--surface)", border: "1px solid var(--surface)", borderRadius: 6, padding: "6px 8px" }}>
                    <div style={{ display: "flex", gap: 6, fontSize: 10, color: "var(--muted)" }}>
                      <span>{log.time}</span>
                      <span style={{ color: log.color, fontWeight: 800 }}>{log.tag}</span>
                    </div>
                    <div style={{ color: "#CBD5E1", fontSize: 11, fontWeight: 600 }}>{log.text}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Automated Rebalancing Ladder */}
            <div className="flipit-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase" }}>Automated Rebalancing Ladder</div>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>•••</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                <span>Asset</span>
                <span>Target</span>
                <span>Current</span>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {holdings.map((a, i) => (
                  <div key={i} className="flipit-spread-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface)", padding: "4px 8px", borderRadius: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: a.col, fontWeight: 900 }}>{a.icon}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text)" }}>{a.name}</span>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{a.target}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 11, color: "var(--text)" }}>{a.current}</span>
                      <span style={{ fontSize: 11, color: a.current === a.target ? "var(--accent)" : (a.up ? "var(--accent)" : "#EF4444") }}>
                        {a.current === a.target ? "✓" : (a.up ? "↑" : "↓")}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Master Glowing Deploy Button */}
              <button
                type="button"
                onClick={async () => {
                  triggerToast("⚡ Connecting to Auto-Scaling Backend...");
                  try {
                    const res = await fetch("/api/flipit/rebalance", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        holdings: [],
                        targetAllocations: [],
                        totalEquityGbp: totalEquity
                      })
                    });
                    if (res.ok) {
                      triggerToast("⚡ Capital successfully deployed to automated rebalancing ladder!");
                      // Make the mock dynamic: Snap the current allocations to the target allocations!
                      setHoldings(prev => prev.map(h => ({ ...h, current: h.target })));
                    } else {
                      triggerToast("⚠️ Failed to reach Rebalance logic tier.");
                    }
                  } catch (e) {
                    triggerToast("⚠️ Network error accessing rebalancer.");
                  }
                }}
                style={{
                  width: "100%", padding: "12px 0",
                  background: "linear-gradient(135deg, var(--accent), #D97706)",
                  border: "none", borderRadius: 10, color: "#000",
                  fontWeight: 900, fontSize: 13, textTransform: "uppercase", letterSpacing: ".06em",
                  cursor: "pointer", boxShadow: "0 4px 20px rgba(245,158,11,0.45)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>
                <Icon name="sparkle" size={15} /> DEPLOY CAPITAL
              </button>
            </div>
          </section>
        </div>
        )}
      </main>
    </div>
  );
}
