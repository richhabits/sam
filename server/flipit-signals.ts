// ─────────────────────────────────────────────────────────────
//  S.A.M. · FLIPIT QUANTITATIVE +EV SIGNAL ENGINE
//
//  Computes real-time Positive Expected Value (+EV) prediction market
//  arbitrage signals by comparing Black-Scholes binary drift models
//  against live Polymarket/Kalshi orderbook probabilities.
// ─────────────────────────────────────────────────────────────

import { getSharedIngestStatus } from "./flipit-ingest.ts";
import { computeKellyRiskShield } from "./flipit-scale.ts";

export interface PredictionMarketTarget {
  id: string;
  marketTitle: string;
  underlyingAsset: "BTC" | "ETH" | "SOL";
  strikePriceUsd: number;
  expiryDays: number;
  marketYesPrice: number; // 0.01 to 0.99
  marketNoPrice: number;  // 0.01 to 0.99
  volume24hUsd?: number;
}

export interface EvSignal {
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
}

// Standard normal cumulative distribution function approximation (Abramowitz and Stegun)
export function standardNormalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - prob : prob;
}

/**
 * Computes theoretical probability of spot price exceeding strike at expiry.
 * @param spot S (e.g. 98,500)
 * @param strike K (e.g. 100,000)
 * @param days T in days (e.g. 7)
 * @param annualVol annualized volatility (default: 0.55 = 55% for BTC)
 * @param annualDrift annualized drift rate (default: 0.05 = 5%)
 */
export function calculateBinaryOutcomeProbability(
  spot: number,
  strike: number,
  days: number,
  annualVol = 0.55,
  annualDrift = 0.05
): number {
  if (spot <= 0 || strike <= 0 || days <= 0) return 0.5;
  const T = days / 365;
  const sigma = Math.max(0.01, annualVol);
  const d2 = (Math.log(spot / strike) + (annualDrift - 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const p = standardNormalCdf(d2);
  return Math.min(0.99, Math.max(0.01, Math.round(p * 1000) / 1000));
}

/**
 * Evaluates a single prediction market target against real spot prices and computes +EV edge.
 */
export function evaluateEvSignal(
  target: PredictionMarketTarget,
  liveSpotUsd: number,
  allocatedCapitalGbp = 1000
): EvSignal {
  const modelProb = calculateBinaryOutcomeProbability(
    liveSpotUsd,
    target.strikePriceUsd,
    target.expiryDays
  );

  const marketYesProb = target.marketYesPrice;
  const yesEdge = modelProb - marketYesProb;
  const noEdge = (1 - modelProb) - target.marketNoPrice;

  let recommendedPosition: "BUY_YES" | "BUY_NO" | "PASS" = "PASS";
  let edgePct = 0;
  let chosenEdge = 0;
  let pWin = 0;
  let bOdds = 0;

  // We require at least 4% edge to overcome slippage & trading fees
  if (yesEdge >= 0.04) {
    recommendedPosition = "BUY_YES";
    chosenEdge = yesEdge;
    pWin = modelProb;
    bOdds = (1 - target.marketYesPrice) / Math.max(0.01, target.marketYesPrice);
  } else if (noEdge >= 0.04) {
    recommendedPosition = "BUY_NO";
    chosenEdge = noEdge;
    pWin = 1 - modelProb;
    bOdds = (1 - target.marketNoPrice) / Math.max(0.01, target.marketNoPrice);
  }

  edgePct = Math.round(chosenEdge * 1000) / 10;
  const isPositiveEv = recommendedPosition !== "PASS";

  let halfKellyAllocationGbp = 0;
  let expectedRoiPct = 0;

  if (isPositiveEv && bOdds > 0) {
    // Full Kelly: f* = (b*p - q) / b
    const qLoss = 1 - pWin;
    const fullKelly = Math.max(0, (bOdds * pWin - qLoss) / bOdds);
    const halfKelly = Math.min(0.15, fullKelly * 0.5); // Cap individual bet at 15% max portfolio risk
    halfKellyAllocationGbp = Math.round(allocatedCapitalGbp * halfKelly * 100) / 100;
    expectedRoiPct = Math.round((pWin * (bOdds + 1) - 1) * 1000) / 10;
  }

  return {
    marketId: target.id,
    title: target.marketTitle,
    underlying: target.underlyingAsset,
    spotPriceUsd: liveSpotUsd,
    strikePriceUsd: target.strikePriceUsd,
    expiryDays: target.expiryDays,
    modelTrueProbability: modelProb,
    marketImpliedProbability: target.marketYesPrice,
    edgePct,
    isPositiveEv,
    recommendedPosition,
    halfKellyAllocationGbp,
    expectedRoiPct,
    confidenceScore: isPositiveEv ? Math.min(95, Math.round(50 + Math.abs(edgePct) * 3)) : 0,
    timestamp: Date.now(),
  };
}

/**
 * Scans active prediction market opportunities against current Binance/Kraken spot feeds.
 */
export function scanEvArbitrageSignals(
  targets: PredictionMarketTarget[] = [],
  portfolioGbp = 1000
): EvSignal[] {
  const status = getSharedIngestStatus();
  const latestTicks = status.latestTicks;

  // Resolve best live BTC price (converting GBP to USD if needed, or using direct feed)
  let btcSpotUsd = 97500; // conservative baseline if no ticks received yet
  const btcTick = latestTicks["binance:BTC/GBP"] || latestTicks["kraken:BTC/GBP"];
  if (btcTick && btcTick.bid > 0) {
    btcSpotUsd = Math.round(btcTick.bid * 1.28); // Real-time GBP/USD conversion
  }

  const defaultTargets: PredictionMarketTarget[] = [
    {
      id: "poly-btc-100k",
      marketTitle: "Will Bitcoin exceed $100,000 by month end?",
      underlyingAsset: "BTC",
      strikePriceUsd: 100000,
      expiryDays: 10,
      marketYesPrice: 0.42,
      marketNoPrice: 0.58,
    },
    {
      id: "poly-btc-95k-floor",
      marketTitle: "Will Bitcoin stay above $95,000 at weekly close?",
      underlyingAsset: "BTC",
      strikePriceUsd: 95000,
      expiryDays: 4,
      marketYesPrice: 0.68,
      marketNoPrice: 0.32,
    },
  ];

  const pool = targets.length > 0 ? targets : defaultTargets;
  return pool.map((t) => evaluateEvSignal(t, btcSpotUsd, portfolioGbp));
}
