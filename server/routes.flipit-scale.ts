import type { Express } from "express";
import { computeKellyRiskShield, scanCrossMarketSpreads } from "./flipit-scale.ts";
import { calculatePortfolioRebalance, type HoldingPosition, type TargetAllocation } from "./flipit-auto.ts";
import { createStripeCheckoutSession, processStripeWebhookEvent, verifyStripeWebhookSignature } from "./stripe-payments.ts";
import { getSharedExecutionEngine, submitPolymarketClobOrder } from "./flipit-execution.ts";
import { getSharedIngestStatus, startSharedIngestEngine, stopSharedIngestEngine } from "./flipit-ingest.ts";
import { scanEvArbitrageSignals } from "./flipit-signals.ts";
import { generateMarketMakerQuotes, calculateDeltaHedge } from "./flipit-market-maker.ts";
import { isLoopback, isTrustedLocal } from "./http-guards.ts";
import { createRateLimiter } from "./rate-limit.ts";

// A CLOB order is real money. Number("1e999") is Infinity, Number("-5") is a short, and Number(x || 0.5)
// quietly turned an explicit 0 into a 0.5 order — so each field is parsed strictly, defaults apply ONLY
// to an omitted field, and anything non-finite, non-positive or oversized is refused rather than clamped.
export const MAX_ORDER_SIZE = 1000;
export function parseOrderParams(rawPrice: unknown, rawSize: unknown): { ok: true; price: number; size: number } | { ok: false; error: string } {
  const price = rawPrice == null ? 0.5 : Number(rawPrice);
  const size = rawSize == null ? 10 : Number(rawSize);
  if (!Number.isFinite(price) || price <= 0 || price >= 1) return { ok: false, error: "price must be a number between 0 and 1 (exclusive)." };
  if (!Number.isFinite(size) || size <= 0 || size > MAX_ORDER_SIZE) return { ok: false, error: `size must be a number greater than 0 and at most ${MAX_ORDER_SIZE}.` };
  return { ok: true, price, size };
}

export function registerFlipItScaleRoutes(app: Express) {
  // The webhook is reachable from outside and verifies an HMAC per call: cap attempts at
  // 120/min per IP (Stripe retries are a handful per event, far below that).
  const webhookLimit = createRateLimiter({ max: 120, message: "Too many webhook requests." });

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
  app.post("/api/flipit/stripe-webhook", webhookLimit, (req, res) => {
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
    // isTrustedLocal, not bare isLoopback: this moves money, and any local process passes isLoopback
    // while knowing no secret. It needs the passkey (or an approved pairing) as well.
    if (!isTrustedLocal(req)) return res.status(403).json({ error: "Trade execution can only be triggered on this computer, with the Handshake." });
    try {
      const { spreadId, pair, sellEx, buyEx, spreadPct, sellPrice, buyPrice, tokenId, price, size, side } = req.body || {};

      if (tokenId) {
        const params = parseOrderParams(price, size);
        if (!params.ok) return res.status(400).json({ error: params.error });
        // Direct Polymarket CLOB Order Execution
        const clobRes = await submitPolymarketClobOrder({
          tokenId: String(tokenId),
          price: params.price,
          size: params.size,
          side: side === "SELL" ? "SELL" : "BUY",
        });
        return res.json(clobRes);
      }

      for (const [k, v] of Object.entries({ spreadPct, sellPrice, buyPrice })) {
        if (v != null && (!Number.isFinite(Number(v)) || Number(v) < 0)) return res.status(400).json({ error: `${k} must be a finite, non-negative number.` });
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

  // Market Maker Quoting
  app.post("/api/flipit/market-maker/quote", (req, res) => {
    try {
      const { spotPriceUsd, strikePriceUsd, expiryDays, currentYesInventory, targetSpreadPct, maxOrderSizeGbp, portfolioCapitalGbp } = req.body || {};
      if (!spotPriceUsd || !strikePriceUsd || !expiryDays) {
        return res.status(400).json({ error: "spotPriceUsd, strikePriceUsd, and expiryDays are required." });
      }

      const quotes = generateMarketMakerQuotes({
        spotPriceUsd: Number(spotPriceUsd),
        strikePriceUsd: Number(strikePriceUsd),
        expiryDays: Number(expiryDays),
        currentYesInventory: currentYesInventory != null ? Number(currentYesInventory) : 0,
        targetSpreadPct: targetSpreadPct != null ? Number(targetSpreadPct) : undefined,
        maxOrderSizeGbp: maxOrderSizeGbp != null ? Number(maxOrderSizeGbp) : undefined,
        portfolioCapitalGbp: portfolioCapitalGbp != null ? Number(portfolioCapitalGbp) : undefined,
      });

      res.json({ success: true, quotes });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to generate market maker quotes" });
    }
  });

  // Delta Hedge Calculation
  app.post("/api/flipit/market-maker/hedge", (req, res) => {
    try {
      const { spotPriceUsd, strikePriceUsd, expiryDays, inventoryContracts, deltaToleranceUsd } = req.body || {};
      if (!spotPriceUsd || !strikePriceUsd || !expiryDays || inventoryContracts == null) {
        return res.status(400).json({ error: "spotPriceUsd, strikePriceUsd, expiryDays, and inventoryContracts are required." });
      }

      const hedge = calculateDeltaHedge(
        Number(spotPriceUsd),
        Number(strikePriceUsd),
        Number(expiryDays),
        Number(inventoryContracts),
        deltaToleranceUsd != null ? Number(deltaToleranceUsd) : undefined
      );

      res.json({ success: true, hedge });
    } catch (e: any) {
      res.status(500).json({ error: e.message || "Failed to compute delta hedge" });
    }
  });
}
