// ── Champion significance gate — PostHog Experiments DNA, ported to the Colosseum ──
//
// PROPOSAL / drop-in (not yet wired). server/ is shared with the local agent — this is a NEW
// file (no collision); wiring it into colosseum.ts/routing is the reviewed step (see foot).
//
// The gap it closes: colosseum.ts crowns `leaderboard[0]` by raw Elo and steers routing to it.
// With ~18 matches across many rotating brains, each brain plays few games, so a 25-Elo gap is
// usually noise — the champion can flip night to night and churn routing for no real reason.
//
// PostHog's Experiments answer: don't declare a winner without statistical significance. We take
// that, and fix the thing PostHog's own docs admit they DON'T do — adjust for multiple
// comparisons. We picked the leader as the MAX of N brains (a winner's-curse selection), so the
// test is Bonferroni-adjusted by N. Decision = one-sided two-proportion z-test on the
// leader-vs-runner-up score rate (wins + ½·ties)/games. Only a *significant* leader re-crowns;
// otherwise routing keeps the incumbent (or the static lane order), which is the stable default.
//
// Verified: posthog-work/verify_significance.mjs — clear 90%-vs-50%@20 crowns (z=3.07); noisy
// 55%-vs-50%@20 does not (z=0.32); <8 games never crowns; tie-heavy strong lead@30 crowns.

import type { Rating } from "./colosseum.ts";

export interface ChampionVerdict {
  champion: string | null;   // id to steer routing to, or null → keep incumbent / static order
  significant: boolean;
  leader?: string;
  runnerUp?: string;
  zStat?: number;
  zCrit?: number;
  reason: string;
}

const score = (r: Rating): number => (r.wins + 0.5 * r.ties) / Math.max(1, r.games);

/** One-sided critical z at `conf`, Bonferroni-adjusted across `comparisons` (Acklam inverse-normal). */
export function zCrit(conf = 0.95, comparisons = 1): number {
  const alpha = (1 - conf) / Math.max(1, comparisons);
  const p = 1 - alpha;   // one-sided
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-7.78489400243029e-3, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [7.78469570904146e-3, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425, ph = 1 - pl;
  let q: number, r: number;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p <= ph) { q = p - 0.5; r = q*q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
  q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

/** Is the top brain SIGNIFICANTLY ahead of #2? If not, don't re-crown — keep the incumbent. */
export function championWithConfidence(leaderboard: Rating[], conf = 0.95, minGames = 8): ChampionVerdict {
  const rated = leaderboard.filter((r) => r.games > 0);
  if (rated.length < 2) return { champion: null, significant: false, reason: "need ≥2 brains with games" };
  const sorted = [...rated].sort((a, b) => score(b) - score(a));
  const L = sorted[0], R = sorted[1];
  if (L.games < minGames || R.games < minGames)
    return { champion: null, significant: false, leader: L.id, runnerUp: R.id,
             reason: `too few games (${L.games}/${R.games} < ${minGames}) — insufficient evidence` };
  const p1 = score(L), p2 = score(R);
  const se = Math.sqrt(p1 * (1 - p1) / L.games + p2 * (1 - p2) / R.games);
  const zStat = se > 0 ? (p1 - p2) / se : 0;
  const zc = zCrit(conf, rated.length);   // adjust for having picked the max of N brains
  const significant = zStat >= zc;
  return {
    champion: significant ? L.id : null, significant,
    leader: L.id, runnerUp: R.id, zStat: +zStat.toFixed(2), zCrit: +zc.toFixed(2),
    reason: significant
      ? `${L.id} beats ${R.id}: z=${zStat.toFixed(2)} ≥ ${zc.toFixed(2)} (adjusted for ${rated.length} brains)`
      : `${L.id} vs ${R.id}: z=${zStat.toFixed(2)} < ${zc.toFixed(2)} — not separable from noise; keep incumbent`,
  };
}

// ── Wiring (the reviewed step, in colosseum.ts saveRanking / the routing read) ──
//   const verdict = championWithConfidence(result.leaderboard);
//   if (verdict.significant) saveRanking(result, now);        // re-crown only on real evidence
//   else log(`arena: ${verdict.reason}`);                     // keep the incumbent ranking, no churn
// This stabilises routing: a fresh benchmark only moves the champion when the win is real,
// which is also the honest thing to tell the user in the Colosseum panel.
