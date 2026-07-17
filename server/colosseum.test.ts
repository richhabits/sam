import { describe, expect, it } from "vitest";
import { type Competitor, expectedScore, formatLeaderboard, parseVerdict, runArena, updateElo } from "./colosseum.ts";

describe("Elo", () => {
  it("equal ratings expect a coin flip", () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5);
  });

  it("a win moves the winner up and the loser down by the same amount", () => {
    const [a, b] = updateElo(1000, 1000, 1);   // A wins
    expect(a).toBeGreaterThan(1000);
    expect(b).toBeLessThan(1000);
    expect(a - 1000).toBeCloseTo(1000 - b);
  });

  it("beating a much stronger opponent is worth more than beating a weaker one", () => {
    const upsetGain = updateElo(1000, 1600, 1)[0] - 1000;   // weak beats strong
    const expectedGain = updateElo(1600, 1000, 1)[0] - 1600; // strong beats weak
    expect(upsetGain).toBeGreaterThan(expectedGain);
  });

  it("a tie barely moves equal ratings", () => {
    const [a, b] = updateElo(1000, 1000, 0.5);
    expect(a).toBeCloseTo(1000);
    expect(b).toBeCloseTo(1000);
  });
});

describe("parseVerdict", () => {
  it("reads A / B and treats TIE/DRAW/garbage as a tie", () => {
    expect(parseVerdict("A")).toBe("A");
    expect(parseVerdict("The winner is B.")).toBe("B");
    expect(parseVerdict("TIE")).toBe("tie");
    expect(parseVerdict("draw")).toBe("tie");
    expect(parseVerdict("¯\\_(ツ)_/¯")).toBe("tie");
  });
});

describe("runArena", () => {
  const brains: Competitor[] = [
    { id: "strong", label: "strong" }, { id: "mid", label: "mid" }, { id: "weak", label: "weak" },
  ];
  const answer = async (id: string, p: string) => `${id}:${p}`;
  // deterministic judge: a fixed skill order always wins, regardless of A/B position (no position bias)
  const rank: Record<string, number> = { strong: 3, mid: 2, weak: 1 };
  const skillJudge = async (_p: string, a: string, b: string) => {
    const sa = rank[a.split(":")[0]], sb = rank[b.split(":")[0]];
    return sa > sb ? "A" : sb > sa ? "B" : "tie";
  };

  it("ranks brains by true skill after a round-robin", async () => {
    const r = await runArena(brains, ["q1", "q2"], answer, skillJudge);
    expect(r.leaderboard.map((x) => x.id)).toEqual(["strong", "mid", "weak"]);
    expect(r.leaderboard[0].wins).toBeGreaterThan(0);
    expect(r.log.length).toBe(3 * 2);   // C(3,2) pairs × 2 prompts
  });

  it("formats a readable leaderboard", async () => {
    const r = await runArena(brains, ["q"], answer, skillJudge);
    expect(formatLeaderboard(r)).toMatch(/Model Colosseum/);
    expect(formatLeaderboard(r)).toMatch(/strong/);
  });
});
