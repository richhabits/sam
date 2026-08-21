import { describe, it, expect } from "vitest";
import { parseSentimentResponse, FlipItOracleEngine } from "./flipit-oracle.ts";

describe("Grounded AI Market Sentiment Oracle", () => {
  it("parses structured JSON sentiment output with boundary constraints", () => {
    const raw = `Here is the analysis:
\`\`\`json
{
  "score": 0.65,
  "confidence": 0.92,
  "reasoning": "Bullish institutional inflows and high liquidity depth."
}
\`\`\``;

    const parsed = parseSentimentResponse(raw);
    expect(parsed.score).toBe(0.65);
    expect(parsed.confidence).toBe(0.92);
    expect(parsed.reasoning).toContain("Bullish institutional inflows");
  });

  it("extracts score via fallback regex when JSON is malformed", () => {
    const raw = "Sentiment score: -0.45. Confidence: 0.85. Macro headwinds detected.";
    const parsed = parseSentimentResponse(raw);
    expect(parsed.score).toBe(-0.45);
    expect(parsed.confidence).toBe(0.85);
  });

  it("instantiates and runs market scan returning verified sentiment signal", async () => {
    const oracle = new FlipItOracleEngine({
      pollIntervalMs: 100_000,
      headlineFetcher: async () => [
        "Bitcoin spot ETF volumes register record net weekly inflow.",
        "Ethereum layer-2 gas consumption reaches multi-month equilibrium.",
      ],
      synthesizer: async () => ({
        text: JSON.stringify({ score: 0.55, confidence: 0.88, reasoning: "Positive institutional ETF demand." }),
      }),
    });
    let emittedSignal: any = null;

    oracle.on("sentiment", (sig) => {
      emittedSignal = sig;
    });

    const signal = await oracle.scanMarketSentiment("BTC/GBP");
    expect(signal.asset).toBe("BTC/GBP");
    expect(typeof signal.score).toBe("number");
    expect(signal.confidence).toBeGreaterThanOrEqual(0.1);
    expect(signal.sourcesScanned).toBeGreaterThan(0);
    expect(emittedSignal).toBeDefined();

    oracle.stop();
  });
});
