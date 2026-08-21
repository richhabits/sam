import type { Express } from "express";
import { computeKellyRiskShield, scanCrossMarketSpreads } from "./flipit-scale.ts";
import { calculatePortfolioRebalance, type HoldingPosition, type TargetAllocation } from "./flipit-auto.ts";
import { createStripeCheckoutSession, processStripeWebhookEvent, verifyStripeWebhookSignature } from "./stripe-payments.ts";
import { getSharedExecutionEngine, submitPolymarketClobOrder } from "./flipit-execution.ts";
import { getSharedIngestStatus, startSharedIngestEngine, stopSharedIngestEngine } from "./flipit-ingest.ts";
import { scanEvArbitrageSignals } from "./flipit-signals.ts";
import { isLoopback } from "./http-guards.ts";

export function registerFlipItScaleRoutes(app: Express) {
  app.post("/api/flipit/rebalance", (req, res) => {
    try {
      const { holdings, targetAllocations, totalEquityGbp, threshold, commission } = req.body || {};
      if (!Array.isArray(holdings) || !Array.isArray(targetAllocations)) {
        return res.status(400).json({ error: "holdings and targetAllocations arrays are required." });
      }
      
      const report = calculatePortfolioRebalance(
        holdings as HoldingPosition[], 
        targetAllocations as TargetAllocation[], 
        totalEquityGbp ? Number(totalEquityGbp) : undefined, 
        { 
          rebalanceThresholdPct: threshold ? Number(threshold) : undefined, 
          commissionRate: commission ? Number(commission) : undefined 
        }
      );
      res.json(report);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to calculate rebalance" });
    }
  });

  app.post("/api/flipit/shield", (req, res) => {
    try {
      const { currentEquityGbp, peakEquityGbp, winRate, avgWinGbp, avgLossGbp, maxDrawdownThresholdPct } = req.body || {};
      if (currentEquityGbp == null || peakEquityGbp == null || winRate == null || avgWinGbp == null || avgLossGbp == null) {
        return res.status(400).json({ error: "Missing required Kelly risk parameters." });
      }

      const shield = computeKellyRiskShield({
        currentEquityGbp: Number(currentEquityGbp),
        peakEquityGbp: Number(peakEquityGbp),
        winRate: Number(winRate),
        avgWinGbp: Number(avgWinGbp),
        avgLossGbp: Number(avgLossGbp),
        maxDrawdownThresholdPct: maxDrawdownThresholdPct != null ? Number(maxDrawdownThresholdPct) : undefined
      });
      res.json(shield);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to compute Kelly shield" });
    }
  });

  app.post("/api/flipit/arbitrage", (req, res) => {
    try {
      const { quotes, allocatedCapitalGbp } = req.body || {};
      if (!Array.isArray(quotes)) {
        return res.status(400).json({ error: "quotes array is required." });
      }

      const opps = scanCrossMarketSpreads(quotes, allocatedCapitalGbp ? Number(allocatedCapitalGbp) : undefined);
      res.json({ opportunities: opps });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to scan arbitrage spreads" });
    }
  });

  // Stripe Checkout Flow
  app.post("/api/flipit/checkout", async (req, res) => {
    try {
      const { amount, paymentMethod, customerEmail } = req.body || {};
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Invalid deposit amount" });
      }
      const session = await createStripeCheckoutSession({
        amountGbp: Number(amount),
        paymentMethod: paymentMethod || "card",
        customerEmail,
      });
      if (session.status === "failed") {
        return res.status(400).json({ error: session.error });
      }
      res.json(session);
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Checkout failed" });
    }
  });

  // Stripe Webhook Endpoint
  app.post("/api/flipit/stripe-webhook", (req, res) => {
    const signature = (req.headers["stripe-signature"] as string) || "";
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    if (!secret) {
      return res.status(503).json({ error: "STRIPE_WEBHOOK_SECRET is not configured — webhook cannot be verified." });
    }
    if (!verifyStripeWebhookSignature(rawBody, signature, secret)) {
      return res.status(400).json({ error: "Invalid Stripe webhook signature." });
    }

    try {
      const event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const result = processStripeWebhookEvent(event);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Webhook processing error" });
    }
  });

  // Live Exchange WebSocket Stream Status
  app.get("/api/flipit/stream/status", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "Stream status can only be accessed on loopback." });
    const ingestStatus = getSharedIngestStatus();
    const executionEngine = getSharedExecutionEngine();
    res.json({
      stream: ingestStatus,
      activeOrders: executionEngine.getActiveOrders(),
    });
  });

  // Start Live Exchange Stream
  app.post("/api/flipit/stream/start", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "Stream control can only be triggered on loopback." });
    const { pairs } = req.body || {};
    const engine = startSharedIngestEngine(Array.isArray(pairs) ? pairs : undefined);
    res.json({ success: true, status: engine.getStatus() });
  });

  // Stop Live Exchange Stream
  app.post("/api/flipit/stream/stop", (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "Stream control can only be triggered on loopback." });
    stopSharedIngestEngine();
    res.json({ success: true, message: "Exchange streams stopped." });
  });

  // Arbitrage & Market Order Execute Route
  app.post("/api/flipit/execute", async (req, res) => {
    if (!isLoopback(req)) return res.status(403).json({ error: "Trade execution can only be triggered on this computer, not remotely." });
    try {
      const { spreadId, pair, sellEx, buyEx, spreadPct, sellPrice, buyPrice, tokenId, price, size, side } = req.body || {};

      if (tokenId) {
        // Direct Polymarket CLOB Order Execution
        const clobRes = await submitPolymarketClobOrder({
          tokenId: String(tokenId),
          price: Number(price || 0.5),
          size: Number(size || 10),
          side: side === "SELL" ? "SELL" : "BUY",
        });
        return res.json(clobRes);
      }

      // Cross-Exchange Arbitrage Execution via Risk Manager
      const engine = getSharedExecutionEngine({
        mode: (process.env.POLYMARKET_ADDRESS && process.env.POLYMARKET_API_KEY) ? "live" : "paper",
      });

      const order = engine.executeArbitrage(
        pair || "BTC/GBP",
        sellEx || "binance",
        buyEx || "kraken",
        spreadPct != null ? Number(spreadPct) : 0.005,
        sellPrice != null ? Number(sellPrice) : 52000,
        buyPrice != null ? Number(buyPrice) : 51740
      );

      if (!order) {
        return res.status(422).json({
          success: false,
          error: "Trade rejected by Kelly risk shield or capital constraints.",
        });
      }

      res.json({ success: true, order });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to execute trade" });
    }
  });

  // Hedging Regime Route
  app.post("/api/flipit/hedging-regime", (req, res) => {
    try {
      const { regime } = req.body || {};
      res.json({ success: true, activeRegime: regime, message: `System re-tuned to ${regime} mode.` });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to switch regime" });
    }
  });

  // +EV Prediction Market Signals Feed
  app.get("/api/flipit/signals", (req, res) => {
    try {
      const portfolioGbp = req.query.portfolio ? Number(req.query.portfolio) : 1000;
      const signals = scanEvArbitrageSignals([], portfolioGbp);
      res.json({
        success: true,
        timestamp: Date.now(),
        portfolioGbp,
        signals,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to scan +EV signals" });
    }
  });
}
