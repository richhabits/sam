// ─────────────────────────────────────────────────────────────
//  S.A.M. · FLIPIT DELTA-NEUTRAL STATISTICAL MARKET MAKER
//
//  Continuous two-sided limit order quoting on prediction markets
//  with Avellaneda-Stoikov inventory skew and real-time spot
//  delta-hedging on Binance / Kraken.
// ─────────────────────────────────────────────────────────────

import { calculateBinaryOutcomeProbability } from "./flipit-signals.ts";

export interface MarketMakerQuoteParams {
  spotPriceUsd: number;
  strikePriceUsd: number;
  expiryDays: number;
  annualVol?: number;
  annualDrift?: number;
  currentYesInventory: number;   // Number of YES contracts currently held (+ = long, - = short)
  targetSpreadPct?: number;       // Base bid-ask spread (e.g. 0.04 = 4 cents)
  riskAversionGamma?: number;    // Avellaneda-Stoikov inventory penalty (e.g. 0.1)
  maxOrderSizeGbp?: number;      // Maximum quote order size in GBP
  portfolioCapitalGbp?: number;  // Available liquidity
}

export interface MarketMakerQuotes {
  fairValue: number;              // Theoretical mid-price (0 to 1)
  reservationPrice: number;       // Inventory-adjusted reservation price
  bidPrice: number;               // Optimal bid quote
  askPrice: number;               // Optimal ask quote
  bidSizeGbp: number;             // Recommended bid capital
  askSizeGbp: number;             // Recommended ask capital
  spreadPct: number;              // Quoted bid-ask spread
  skewDirection: "LONG_HEAVY" | "SHORT_HEAVY" | "NEUTRAL";
}

export interface DeltaHedgeRecommendation {
  binaryDelta: number;            // Sensitivity of YES contract to $1 change in spot (dPrice/dSpot)
  totalPortfolioDeltaUsd: number; // Net USD directional risk of open binary inventory
  requiredSpotHedgeAction: "BUY_SPOT" | "SELL_SPOT" | "FLAT";
  hedgeAmountSpotUsd: number;     // USD volume of spot required on Binance/Kraken
  hedgeAmountCryptoUnits: number; // Units of BTC/ETH required
  isHedgeRequired: boolean;       // True if absolute net delta > tolerance threshold
}

/**
 * Standard Normal Probability Density Function: phi(x) = (1 / sqrt(2 * pi)) * exp(-0.5 * x^2)
 */
export function standardNormalPdf(x: number): number {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

/**
 * Computes the analytical Delta of a European binary (digital) call option.
 * Delta = phi(d2) / (S * sigma * sqrt(T))
 */
export function calculateBinaryDelta(
  spot: number,
  strike: number,
  expiryDays: number,
  annualVol = 0.55,
  annualDrift = 0.05
): number {
  if (spot <= 0 || strike <= 0 || expiryDays <= 0) return 0;

  const t = expiryDays / 365;
  const sqrtT = Math.sqrt(t);
  const sigmaSqrtT = annualVol * sqrtT;

  const d1 = (Math.log(spot / strike) + (annualDrift + 0.5 * annualVol * annualVol) * t) / sigmaSqrtT;
  const d2 = d1 - sigmaSqrtT;

  const pdf = standardNormalPdf(d2);
  const delta = pdf / (spot * annualVol * sqrtT);
  return Number(delta.toFixed(8));
}

/**
 * Calculates optimal Avellaneda-Stoikov inventory-skewed two-sided quotes.
 */
export function generateMarketMakerQuotes(params: MarketMakerQuoteParams): MarketMakerQuotes {
  const {
    spotPriceUsd,
    strikePriceUsd,
    expiryDays,
    annualVol = 0.55,
    annualDrift = 0.05,
    currentYesInventory,
    targetSpreadPct = 0.04,
    riskAversionGamma = 0.08,
    maxOrderSizeGbp = 100,
    portfolioCapitalGbp = 1000,
  } = params;

  const fairValue = calculateBinaryOutcomeProbability(spotPriceUsd, strikePriceUsd, expiryDays, annualVol, annualDrift);

  // Avellaneda-Stoikov reservation price: r(s, q, t) = s - q * gamma * sigma^2 * (T - t)
  const t = expiryDays / 365;
  const variance = annualVol * annualVol;
  const inventoryPenalty = currentYesInventory * riskAversionGamma * variance * t;
  
  // Bound reservation price in (0.01, 0.99)
  const reservationPrice = Math.min(0.98, Math.max(0.02, fairValue - inventoryPenalty));

  const halfSpread = targetSpreadPct / 2;
  const bidPrice = Math.max(0.01, Number((reservationPrice - halfSpread).toFixed(3)));
  const askPrice = Math.min(0.99, Number((reservationPrice + halfSpread).toFixed(3)));

  // Size quotes inversely to current inventory imbalance (quote smaller on the heavy side)
  const capitalBase = Math.min(maxOrderSizeGbp, portfolioCapitalGbp * 0.1);
  let bidSize = capitalBase;
  let askSize = capitalBase;

  if (currentYesInventory > 10) {
    bidSize = Math.max(10, capitalBase * 0.5); // Discourage buying more
    askSize = Math.min(maxOrderSizeGbp * 1.5, capitalBase * 1.5); // Encourage unloading
  } else if (currentYesInventory < -10) {
    bidSize = Math.min(maxOrderSizeGbp * 1.5, capitalBase * 1.5);
    askSize = Math.max(10, capitalBase * 0.5);
  }

  const skewDirection: MarketMakerQuotes["skewDirection"] =
    currentYesInventory > 5 ? "LONG_HEAVY" : currentYesInventory < -5 ? "SHORT_HEAVY" : "NEUTRAL";

  return {
    fairValue: Number(fairValue.toFixed(4)),
    reservationPrice: Number(reservationPrice.toFixed(4)),
    bidPrice,
    askPrice,
    bidSizeGbp: Math.round(bidSize),
    askSizeGbp: Math.round(askSize),
    spreadPct: Number((askPrice - bidPrice).toFixed(3)),
    skewDirection,
  };
}

/**
 * Evaluates directional delta exposure and recommends exact spot hedging transactions.
 */
export function calculateDeltaHedge(
  spotPriceUsd: number,
  strikePriceUsd: number,
  expiryDays: number,
  inventoryContracts: number,
  deltaToleranceUsd = 25
): DeltaHedgeRecommendation {
  const binaryDelta = calculateBinaryDelta(spotPriceUsd, strikePriceUsd, expiryDays);
  
  // Total dollar delta = contracts * binaryDelta * spotPrice
  const totalPortfolioDeltaUsd = Number((inventoryContracts * binaryDelta * spotPriceUsd).toFixed(2));
  const isHedgeRequired = Math.abs(totalPortfolioDeltaUsd) >= deltaToleranceUsd;

  let requiredSpotHedgeAction: DeltaHedgeRecommendation["requiredSpotHedgeAction"] = "FLAT";
  let hedgeAmountSpotUsd = 0;
  let hedgeAmountCryptoUnits = 0;

  if (isHedgeRequired) {
    // If net delta is positive (long underlying exposure), sell spot. If negative, buy spot.
    if (totalPortfolioDeltaUsd > 0) {
      requiredSpotHedgeAction = "SELL_SPOT";
      hedgeAmountSpotUsd = totalPortfolioDeltaUsd;
    } else {
      requiredSpotHedgeAction = "BUY_SPOT";
      hedgeAmountSpotUsd = Math.abs(totalPortfolioDeltaUsd);
    }
    hedgeAmountCryptoUnits = Number((hedgeAmountSpotUsd / spotPriceUsd).toFixed(6));
  }

  return {
    binaryDelta,
    totalPortfolioDeltaUsd,
    requiredSpotHedgeAction,
    hedgeAmountSpotUsd: Number(hedgeAmountSpotUsd.toFixed(2)),
    hedgeAmountCryptoUnits,
    isHedgeRequired,
  };
}
