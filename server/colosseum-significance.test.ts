import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { championWithConfidence, zCrit } from "./colosseum-significance.ts";

const r = (id: string, wins: number, losses: number, ties = 0) => ({
  id, label: id, elo: 1000, wins, losses, ties, games: wins + losses + ties,
});

// The arena used to persist leaderboard[0] by raw Elo (colosseum.ts saveRanking), so a gap
// well inside the noise could flip the champion night to night and churn routing. This gate
// only re-crowns on evidence. Ported from PostHog's Experiments DNA, plus the adjustment
// PostHog's own docs say they skip: we pick the MAX of N brains, so alpha is Bonferroni'd by N.
describe("championWithConfidence", () => {
  it("crowns a clear leader", () => {
    const v = championWithConfidence([r("groq", 18, 2), r("next", 10, 10)]);
    expect(v.significant).toBe(true);
    expect(v.champion).toBe("groq");
    expect(v.zStat!).toBeGreaterThan(v.zCrit!);
  });

  it("refuses a noisy lead — 55% vs 50% is not evidence", () => {
    const v = championWithConfidence([r("groq", 11, 9), r("next", 10, 10)]);
    expect(v.significant).toBe(false);
    expect(v.champion).toBeNull();
  });

  it("refuses on too few games regardless of margin", () => {
    const v = championWithConfidence([r("groq", 4, 0), r("next", 0, 4)]);
    expect(v.significant).toBe(false);
    expect(v.reason).toMatch(/too few games/);
  });

  it("counts ties as half-wins", () => {
    const v = championWithConfidence([r("groq", 20, 4, 6), r("next", 10, 14, 6)]);
    expect(v.significant).toBe(true);
  });

  it("gets STRICTER as more brains compete (winner's curse)", () => {
    // Picking the max of N brains is a selection effect; the threshold must rise with N.
    expect(zCrit(0.95, 8)).toBeGreaterThan(zCrit(0.95, 2));
  });

  it("never crowns when the field is a single brain", () => {
    expect(championWithConfidence([r("solo", 9, 0)]).significant).toBe(false);
  });
});

// A gate that exists but isn't called is the failure mode this repo keeps finding: it looks
// installed and changes nothing. These pin the wiring itself.
describe("the gate is actually wired", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const tools = readFileSync(join(here, "tools.ts"), "utf8");

  it("benchmarkBrains gates saveRanking behind the verdict", () => {
    expect(tools).toContain("championWithConfidence(result.leaderboard)");
    const block = tools.slice(tools.indexOf("const verdict = championWithConfidence"));
    const save = block.indexOf("saveRanking");
    const guard = block.indexOf("if (verdict.significant)");
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(guard).toBeLessThan(save);   // the save must sit INSIDE the significance branch
  });

  it("the nightly runs enough prompts for the gate to be able to fire", () => {
    // 4 competitors -> 6 pairs; games/brain = 3 x prompts. Below ~8 prompts the gate can
    // essentially never crown, so raising this was part of wiring it honestly.
    const sh = readFileSync(join(here, "..", "scripts", "daily_benchmark.sh"), "utf8");
    const body = /BODY='(.*)'/.exec(sh)![1];
    const prompts = JSON.parse(body).prompts as string[];
    expect(prompts.length).toBeGreaterThanOrEqual(8);
    expect(prompts.length * 3).toBeGreaterThanOrEqual(23);   // games per brain
  });
});
