import { describe, it, expect } from "vitest";
import { generateExecutiveDailyDeck } from "./executive-deck.ts";

describe("EXECUTIVE DAILY BRIEF & ACTION DECK GENERATOR", () => {
  it("compiles multi-source intelligence into executive action deck", async () => {
    const deck = await generateExecutiveDailyDeck();
    expect(deck.systemReadinessScorePct).toBeGreaterThan(0);
    expect(deck.totalPendingActions).toBeGreaterThanOrEqual(1);
    expect(deck.cards.length).toBeGreaterThanOrEqual(1);
    expect(deck.estimatedDailyAlphaUSD).toBeGreaterThan(0);
    expect(deck.quickMetrics.onlineServices).toBeGreaterThan(0);
  });
});
