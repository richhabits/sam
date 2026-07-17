import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ArenaResult, type Competitor, clearRanking, expectedScore, formatLeaderboard, loadRanking, parseVerdict, RANKING_MAX_AGE_DAYS, rankingStale, runArena, saveRanking, updateElo } from "./colosseum.ts";
import { arenaSort } from "./models.ts";

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

describe("ranking → routing", () => {
  const prev = process.env.VAULT_DIR;
  beforeAll(() => { process.env.VAULT_DIR = mkdtempSync(join(tmpdir(), "sam-arena-")); });
  afterAll(() => { if (prev === undefined) delete process.env.VAULT_DIR; else process.env.VAULT_DIR = prev; });

  const result: ArenaResult = {
    log: [], leaderboard: [
      { id: "groq", label: "groq", elo: 1046, wins: 3, losses: 0, ties: 0, games: 3 },
      { id: "cerebras", label: "cerebras", elo: 970, wins: 0, losses: 3, ties: 0, games: 3 },
    ],
  };
  const P = (id: string) => ({ id, tier: "free" as const, label: id, run: async () => "" });

  it("saves and reloads the ranking", () => {
    saveRanking(result, "2026-07-17T00:00:00Z");
    const r = loadRanking();
    expect(r?.top).toBe("groq");
    expect(r?.elo.groq).toBe(1046);
  });

  it("clearRanking forgets it → routing has nothing to steer by", () => {
    saveRanking(result, "2026-07-17T00:00:00Z");
    expect(loadRanking()).not.toBeNull();
    clearRanking();
    expect(loadRanking()).toBeNull();
    expect(arenaSort([P("cerebras"), P("groq")]).map((p) => p.id)).toEqual(["cerebras", "groq"]);   // back to static order
  });

  it("arenaSort tries the higher-Elo brain first once a benchmark is on file", () => {
    saveRanking(result, "2026-07-17T00:00:00Z");
    const ordered = arenaSort([P("cerebras"), P("groq")]).map((p) => p.id);
    expect(ordered[0]).toBe("groq");   // arena winner leads, even though it was passed in second
  });

  it("leaves unranked brains in their incoming order (stable)", () => {
    saveRanking(result, "2026-07-17T00:00:00Z");
    const ordered = arenaSort([P("mystery1"), P("mystery2")]).map((p) => p.id);
    expect(ordered).toEqual(["mystery1", "mystery2"]);   // both neutral 1000 → order preserved
  });

  it("ignores a stale ranking — routing falls back to the incoming order", () => {
    // save a ranking dated well past the window, then confirm the winner is NOT promoted
    const old = new Date(Date.now() - (RANKING_MAX_AGE_DAYS + 3) * 86_400_000).toISOString();
    saveRanking(result, old);
    const ordered = arenaSort([P("cerebras"), P("groq")]).map((p) => p.id);
    expect(ordered).toEqual(["cerebras", "groq"]);   // stale → static order kept (groq NOT pulled first)
  });
});

describe("rankingStale", () => {
  const now = Date.parse("2026-07-17T12:00:00Z");
  it("fresh within the window, stale past it", () => {
    expect(rankingStale("2026-07-17T00:00:00Z", now)).toBe(false);            // hours old
    expect(rankingStale("2026-07-01T00:00:00Z", now)).toBe(true);             // ~16 days old
  });
  it("treats an unparseable timestamp as stale", () => {
    expect(rankingStale("not-a-date", now)).toBe(true);
  });
});
