// ── Model Colosseum — head-to-head LLM ranking (clean-room port of llm-colosseum, MIT) ──
// The portable idea from the Street-Fighter benchmark, minus the game: pit SAM's rotating free
// brains against each other on real prompts, let an impartial judge pick the winner, and rank
// them by Elo. SAM sells "free brains rotating" — this is the leaderboard that says which is
// actually winning. Core logic takes injected answer/judge fns, so it's testable without network.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface Competitor { id: string; label: string; }
export interface Rating { id: string; label: string; elo: number; wins: number; losses: number; ties: number; games: number; }
export interface MatchLog { prompt: string; aId: string; bId: string; winner: "A" | "B" | "tie"; }
export interface ArenaResult { leaderboard: Rating[]; log: MatchLog[]; }

export type AnswerFn = (id: string, prompt: string) => Promise<string>;
export type JudgeFn = (prompt: string, a: string, b: string) => Promise<"A" | "B" | "tie">;

// ── Elo (pure) ──
export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}
export function updateElo(ratingA: number, ratingB: number, scoreA: number, k = 32): [number, number] {
  const eA = expectedScore(ratingA, ratingB);
  return [ratingA + k * (scoreA - eA), ratingB + k * ((1 - scoreA) - (1 - eA))];
}

// ── judging ──
export const JUDGE_SYSTEM =
  "You are an impartial judge scoring two AI answers to the same question. Judge only on " +
  "helpfulness, correctness and clarity — ignore length and style. Reply with EXACTLY one token: " +
  "A if the first answer is better, B if the second is better, or TIE if they're equal.";

export function judgePrompt(prompt: string, a: string, b: string): string {
  return `QUESTION:\n${prompt}\n\nANSWER A:\n${a}\n\nANSWER B:\n${b}\n\nWinner (A / B / TIE)?`;
}

export function parseVerdict(text: string): "A" | "B" | "tie" {
  const m = (text || "").trim().toUpperCase().match(/\b(A|B|TIE|DRAW)\b/);
  if (!m || m[1] === "DRAW" || m[1] === "TIE") return "tie";
  return m[1] as "A" | "B";
}

// ── the arena ──
function uniquePairs<T>(xs: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push([xs[i], xs[j]]);
  return out;
}

export async function runArena(
  competitors: Competitor[], prompts: string[], answer: AnswerFn, judge: JudgeFn, k = 32,
): Promise<ArenaResult> {
  const R = new Map<string, Rating>();
  for (const c of competitors) R.set(c.id, { id: c.id, label: c.label, elo: 1000, wins: 0, losses: 0, ties: 0, games: 0 });

  const log: MatchLog[] = [];
  const pairs = uniquePairs(competitors);
  let flip = false;   // alternate who is "A" each match to blunt the judge's position bias

  for (const prompt of prompts) {
    for (const [x, y] of pairs) {
      const [a, b] = flip ? [y, x] : [x, y];
      flip = !flip;
      const [ansA, ansB] = await Promise.all([answer(a.id, prompt), answer(b.id, prompt)]);
      const winner = await judge(prompt, ansA, ansB);
      log.push({ prompt, aId: a.id, bId: b.id, winner });

      const ra = R.get(a.id)!, rb = R.get(b.id)!;
      const scoreA = winner === "A" ? 1 : winner === "B" ? 0 : 0.5;
      [ra.elo, rb.elo] = updateElo(ra.elo, rb.elo, scoreA, k);
      ra.games++; rb.games++;
      if (winner === "tie") { ra.ties++; rb.ties++; }
      else if (winner === "A") { ra.wins++; rb.losses++; }
      else { rb.wins++; ra.losses++; }
    }
  }

  const leaderboard = [...R.values()].sort((p, q) => q.elo - p.elo);
  return { leaderboard, log };
}

// ── persisted ranking → steers routing (the free-tier cascade prefers higher-Elo brains) ──
export interface SavedRanking { ts: string; top: string; elo: Record<string, number>; }

const vaultDir = () => process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const rankFile = () => join(vaultDir(), "arena-ranking.json");
let _cache: { at: number; val: SavedRanking | null } | null = null;

export function saveRanking(r: ArenaResult, now: string): void {
  if (!r.leaderboard.length) return;
  const elo: Record<string, number> = {};
  for (const x of r.leaderboard) elo[x.id] = Math.round(x.elo);
  const payload: SavedRanking = { ts: now, top: r.leaderboard[0].id, elo };
  try {
    mkdirSync(vaultDir(), { recursive: true });
    writeFileSync(rankFile(), JSON.stringify(payload, null, 2));
    _cache = { at: 0, val: payload };   // force fresh read next call, but keep the value handy
  } catch { /* best-effort — routing just falls back to the static order */ }
}

export function loadRanking(): SavedRanking | null {
  if (_cache && Date.now() - _cache.at < 5000) return _cache.val;   // cheap cache off the routing hot path
  let val: SavedRanking | null = null;
  try { if (existsSync(rankFile())) val = JSON.parse(readFileSync(rankFile(), "utf8")); } catch { /* ignore */ }
  _cache = { at: Date.now(), val };
  return val;
}

export function formatLeaderboard(r: ArenaResult): string {
  if (!r.leaderboard.length) return "No brains available to benchmark.";
  const rows = r.leaderboard.map((x, i) =>
    `${String(i + 1).padStart(2)}. ${x.label.padEnd(28)} ${Math.round(x.elo).toString().padStart(5)}  (${x.wins}-${x.losses}-${x.ties})`);
  return `Model Colosseum — ${r.log.length} matches\n#   brain                         elo   (W-L-T)\n${rows.join("\n")}`;
}
