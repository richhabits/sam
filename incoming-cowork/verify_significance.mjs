// Champion-significance (PostHog Experiments DNA + the fix PostHog SKIPS: adjust for the
// multiple comparisons created by picking the max of N brains). Decision = one-sided
// two-proportion z-test on the leader-vs-runner-up score rate, at a Bonferroni-adjusted
// alpha. (First cut used non-overlapping CIs — too conservative; the correct test is on
// the DIFFERENCE, which the verification below caught.)

function zCrit(conf, comparisons) {
  const alpha = (1 - conf) / Math.max(1, comparisons);   // Bonferroni across N brains (winner's curse)
  const p = 1 - alpha;                                    // one-sided: we only crown if leader > runner-up
  const a=[-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924];
  const b=[-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857];
  const c=[-7.78489400243029e-3,-0.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878];
  const d=[7.78469570904146e-3,0.32246712907004,2.445134137143,3.75440866190742];
  const pl=0.02425,ph=1-pl; let q,r;
  if(p<pl){q=Math.sqrt(-2*Math.log(p));return(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}
  if(p<=ph){q=p-0.5;r=q*q;return(((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);}
  q=Math.sqrt(-2*Math.log(1-p));return-(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

function championWithConfidence(leaderboard, conf = 0.95, minGames = 8) {
  const rated = leaderboard.filter(r => r.games > 0);
  if (rated.length < 2) return { champion: null, significant: false, reason: "need >=2 brains with games" };
  const score = r => (r.wins + 0.5 * r.ties) / r.games;
  const sorted = [...rated].sort((a, b) => score(b) - score(a));
  const L = sorted[0], R = sorted[1];
  if (L.games < minGames || R.games < minGames)
    return { champion: null, significant: false, leader: L.id, runnerUp: R.id,
             reason: `too few games (${L.games}/${R.games} < ${minGames}) — insufficient evidence` };
  const p1 = score(L), p2 = score(R);
  const se = Math.sqrt(p1 * (1 - p1) / L.games + p2 * (1 - p2) / R.games);
  const zStat = se > 0 ? (p1 - p2) / se : 0;
  const zc = zCrit(conf, rated.length);
  const significant = zStat >= zc;
  return {
    champion: significant ? L.id : null, significant,
    leader: L.id, runnerUp: R.id, zStat: +zStat.toFixed(2), zCrit: +zc.toFixed(2),
    reason: significant
      ? `${L.id} beats ${R.id}: z=${zStat.toFixed(2)} ≥ ${zc.toFixed(2)} (adj. for ${rated.length} brains)`
      : `${L.id} vs ${R.id}: z=${zStat.toFixed(2)} < ${zc.toFixed(2)} — not separable from noise, keep incumbent`,
  };
}

let pass = 0, fail = 0;
const check = (n, c) => { (c ? pass++ : fail++); console.log(`  [${c ? "PASS" : "FAIL"}] ${n}`); };

const clear = championWithConfidence([
  { id: "groq", wins: 18, losses: 2, ties: 0, games: 20 },
  { id: "next", wins: 10, losses: 10, ties: 0, games: 20 }]);
check("clear leader (90% vs 50%, n=20) IS significant → crowned", clear.significant && clear.champion === "groq");
console.log("      →", clear.reason);

const close = championWithConfidence([
  { id: "groq", wins: 11, losses: 9, ties: 0, games: 20 },
  { id: "next", wins: 10, losses: 10, ties: 0, games: 20 }]);
check("close leader (55% vs 50%, n=20) NOT significant → keep incumbent", !close.significant);
console.log("      →", close.reason);

const few = championWithConfidence([
  { id: "groq", wins: 3, losses: 1, ties: 0, games: 4 },
  { id: "cerebras", wins: 2, losses: 2, ties: 0, games: 4 }]);
check("4-game lead NOT significant (min-games guard, the arena reality)", !few.significant);
console.log("      →", few.reason);

// ties handled as half-wins; a strong but tie-heavy lead over enough games can still separate
const ties = championWithConfidence([
  { id: "groq", wins: 20, losses: 4, ties: 6, games: 30 },
  { id: "next", wins: 10, losses: 14, ties: 6, games: 30 }]);
check("ties counted as half-wins; strong lead over n=30 IS significant", ties.significant);
console.log("      →", ties.reason);

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
