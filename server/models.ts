// ─────────────────────────────────────────────────────────────
//  S.A.M. · MODEL PROVIDERS  (rotating key vault, free-first)
//  local (Ollama) → free (Gemini · Groq · OpenRouter) → premium
//  (Claude · OpenAI). Every cloud provider pulls from a rotating
//  key pool so SAM never rate-limits itself, and always falls
//  back down the chain — it never goes dark.
//
//  Add a provider = one entry in PROVIDERS below. That's it.
// ─────────────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRanking, rankingStale } from "./colosseum.ts";
import { getKey, keyStatus, poolSize, reportFailure, reportSuccess } from "./keys.ts";
import { costUSD, estTokens, recordModelCall } from "./metrics.ts";
import { count, mark, observe } from "./pulse.ts";
import { relayBrain } from "./relay.ts";
import { collapseRepetition, isDegenerateRepetition } from "./repetition.ts";
import { healthOrder } from "./speed.ts";
import { classifyPromptTier } from "./speculative-router.ts";
import { recordCostSavings } from "./cost-optimizer.ts";

export type Tier = "local" | "free" | "premium";
export interface ModelResult { text: string; provider: string; tier: Tier }

// ── BENCH MOCK ── deterministic, offline brain so scripts/bench.ts can exercise the FULL
// real pipeline (routing, prompt assembly, cache, agent loop) with zero network + zero quota.
// Gated behind SAM_BENCH_MOCK so production is untouched. Latency is MODELLED per tier (the
// ratios — local < free < premium — are what before/after deltas care about, documented as such).
const BENCH_MOCK = process.env.SAM_BENCH_MOCK === "1";
const MOCK_LATENCY: Record<Tier, number> = { local: 40, free: 200, premium: 500 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function mockText(tier: Tier): string {
  // A stable, plausible answer sized to a realistic short reply (~50 tokens).
  return `[${tier}] Done — here's a clear, useful answer to that. ` +
    "It covers the key point directly and stays tight, the way SAM replies when it's on form.";
}
async function mockRun(tier: Tier): Promise<ModelResult> {
  await sleep(MOCK_LATENCY[tier]);
  return { text: mockText(tier), provider: `mock:${tier}`, tier };
}

import { callOllama, callGateway, OLLAMA_MODEL, OLLAMA_URL, PROVIDERS, type Provider, deviceId, warmBrain, GATEWAY_URL, GROQ_MODEL, streamOpenAICompat, streamGemini, callOllamaStream } from "./model-providers.ts";
export { deviceId, warmBrain, GATEWAY_URL, type Provider, PROVIDERS };

// Try one provider, rotating through its key pool on failure.
async function tryProvider(prov: Provider, system: string, prompt: string): Promise<string | null> {
  // Route through the Relay (one policy chain — Breaker, key pool, boundary, failure capture).
  // On by default now the Relay is proven; SAM_RELAY=0 is the kill-switch back to the plain path.
  if (process.env.SAM_RELAY !== "0") {
    const r = await relayBrain(
      { id: prov.id, boundary: prov.tier === "local" ? "local" : "cloud", noKey: prov.noKey, run: prov.run },
      system, prompt, { allowCloud: true },   // the cascade already decided cloud is permitted here
    );
    return r.ok ? r.value : null;   // any RelayError (blocked/breaker/no-key/failed) → cascade to the next provider
  }
  if (prov.noKey) {   // no-key provider (Pollinations) — retry a couple of times; transient hiccups are common
    for (let i = 0; i < 2; i++) {
      try { const text = await prov.run(system, prompt, ""); if (text) return text; } catch { /* retry, then fall through */ }
      if (i === 0) await new Promise((r) => setTimeout(r, 800));
    }
    return null;
  }
  const attempts = Math.max(1, poolSize(prov.id));
  for (let i = 0; i < attempts; i++) {
    const key = getKey(prov.id);
    if (!key) return null;
    try {
      const text = await prov.run(system, prompt, key);
      if (text) { reportSuccess(prov.id, key); return text; }
    } catch (e: any) {
      reportFailure(prov.id, key, e?.status);
      // 4xx that isn't rate-limit = bad key/request; stop hammering this provider
      if (e?.status && e.status !== 429 && e.status < 500) break;
    }
  }
  return null;
}

// SMART USAGE ("Oliver Twist" — take a little, ask the next). Instead of hammering the
// single fastest provider for EVERY request until it rate-limits, we round-robin the
// starting point across the top few best-fit free providers, so each one's free quota is
// sipped lightly and lasts far longer. More total free-ness, same speed (all top picks
// are fast). A module counter is enough — no randomness needed.
let rrCounter = 0;
function spreadLoad(ranked: Provider[]): Provider[] {
  if (ranked.length < 2) return ranked;
  const spread = Math.min(3, ranked.length);            // rotate among the top few only
  const start = (rrCounter++) % spread;
  return [...ranked.slice(start, spread), ...ranked.slice(0, start), ...ranked.slice(spread)];
}

// Colosseum → routing: once a benchmark has run, prefer the brains it rated higher (Elo desc),
// keeping the incoming lane order as a stable tiebreaker. No ranking on file ⇒ pool unchanged.
export function arenaSort(pool: Provider[]): Provider[] {
  const rank = loadRanking();
  // No ranking, or one too old to trust → keep the incoming (static lane) order.
  if (!rank || rankingStale(rank.ts, Date.now())) return pool;
  // Ranked brains lead in Elo order; UNRANKED brains fall BELOW all of them — a brain we tested
  // and rated (even one that lost) beats one we never tested, instead of a neutral 1000 that let
  // untested brains leapfrog the benchmark's losers. Finite floor keeps the comparator NaN-free.
  const vals = Object.values(rank.elo);
  const floor = (vals.length ? Math.min(...vals) : 1000) - 1;
  const elo = (id: string) => rank.elo[id] ?? floor;
  return pool.map((p, i) => ({ p, i })).sort((a, b) => elo(b.p.id) - elo(a.p.id) || a.i - b.i).map((x) => x.p);
}

// Free-tier ordering. With an active ranking: PIN the champion first (always tried first, falling
// through only if it's actually down), then spread-load the runners-up so their quotas still
// rotate. Without a ranking: the original behaviour — spread-load the static lane order.
export function freeOrder(pool: Provider[], lane: Lane): Provider[] {
  const laned = laneSort(pool, lane);
  const rank = loadRanking();
  const ordered = !rank || rankingStale(rank.ts, Date.now())
    ? spreadLoad(laned)
    : (() => { const s = arenaSort(laned); return s.length > 1 ? [s[0], ...spreadLoad(s.slice(1))] : s; })();
  // LAST, over everything above it: what actually happened when SAM called these. Lane preference
  // says which brain is RIGHT for the job and Elo says which is BEST — neither notices that the
  // brain has been answering 404 since its provider retired the model slug. Measurement does, and
  // it only sinks the dead and the measurably slow; everything else keeps the order chosen above.
  return healthOrder(ordered);
}

// ── DISPATCH with graceful fallback ──────────────────────────
// ── TASK-AWARE LANES ─────────────────────────────────────────
// 30+ free models is a lot of firepower — so use the RIGHT one FIRST for the job:
// blazing-fast small models for quick chat, big reasoning models for hard problems,
// code-strong ones for programming. It still falls through ALL free providers on
// failure (nothing wasted) — this only changes which is TRIED first.
export type Lane = "fast" | "deep" | "code";
// AUDITED LIVE 2026-08-01. `hermes` led BOTH deep and code, and Nous now charges for it — it
// answers 402 with an x402 payment challenge, so every deep or code turn opened with a failure
// before reaching a brain that works. It stays in the cascade (a key/entitlement makes it answer
// again) but it no longer leads. Measured on the day: groq 115ms · mistral 297ms · gemini 430ms ·
// cerebras 422ms (after the slug fix) · nvidia 11s.
const LANE_PREF: Record<Lane, string[]> = {
  // fastest inference first (default — keeps quick chat snappy)
  fast: ["cerebras", "groq", "mistral", "sambanova"],
  // biggest / strongest reasoning free models first
  deep: ["zhipu", "deepseek", "together", "alibaba", "fireworks", "cerebras", "groq", "hermes"],
  // strongest at code first
  code: ["zhipu", "deepseek", "fireworks", "together", "cerebras", "groq", "hermes"],
};
export function pickLane(text: string): Lane {
  const t = (text || "").slice(0, 600).toLowerCase();
  if (/```|\b(debug|refactor|stack ?trace|compile|regex|typescript|javascript|python|\bnpm\b|traceback|exception|syntax error|stack overflow)\b/.test(t)) return "code";
  if (t.length > 280 || /\b(analy[sz]e|explain why|strateg|compare\b|pros and cons|think through|break ?down|evaluate|deep dive|trade-?offs?|reason through|assess\b)\b/.test(t)) return "deep";
  return "fast";
}
// Stable-sort a free-tier pool so lane-preferred providers come first; unlisted keep order.
function laneSort(pool: Provider[], lane: Lane): Provider[] {
  const pref = LANE_PREF[lane];
  const rank = (id: string) => { const i = pref.indexOf(id); return i === -1 ? 999 : i; };
  return pool.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.id) - rank(b.p.id) || a.i - b.i).map((x) => x.p);
}

// Cheap cached check: is a local Ollama up WITH a model pulled? (private, offline, zero-key brain)
let _ollamaOk: boolean | null = null, _ollamaAt = 0;
export async function ollamaReady(): Promise<boolean> {
  const now = Date.now();
  if (_ollamaOk !== null && now - _ollamaAt < 30_000) return _ollamaOk;
  _ollamaAt = now;
  try { const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) }); const d: any = r.ok ? await r.json() : null; _ollamaOk = !!(d?.models?.length); }
  catch { _ollamaOk = false; }
  return _ollamaOk;
}
// Any cloud provider with a real key pooled? (noKey lanes like Pollinations don't count as "has keys")
function hasCloudKeys(): boolean { return PROVIDERS.some((p) => p.tier === "free" && !p.noKey && poolSize(p.id) > 0); }

// ── THE HEDGE ────────────────────────────────────────────────
// How long the leader gets on its own before the next brain is started ALONGSIDE it. Sized from
// the audit: the healthy free brains answered in 115–430ms, so a brain that has said nothing in
// ~1.4s is not "nearly done", it's stalled. Deep/code lanes think for longer, so they wait longer.
const HEDGE_MS: Record<Lane, number> = { fast: 1400, deep: 4000, code: 4000 };
// Never more than this many free calls in flight for one turn. The hedge trades a little free
// quota for latency; unbounded, it would trade ALL of it.
const MAX_INFLIGHT = Number(process.env.SAM_HEDGE_INFLIGHT) || 3;

/**
 * Walk the pool, starting the next brain whenever the ones already running have gone quiet for
 * the hedge window, and return the first real answer. Losers are left to finish — their fetches
 * can't be cancelled through the provider closures, and their outcomes still teach the health
 * memory something. SAM_HEDGE=0 falls back to the strictly serial walk.
 */
export async function hedged(
  pool: Provider[],
  system: string,
  prompt: string,
  lane: Lane,
  // Injectable so the hedge can be tested without a network: the RACE is the thing worth pinning,
  // not who wins it.
  opts: { run?: (p: Provider) => Promise<string | null>; waitMs?: number } = {},
): Promise<{ text: string; prov: Provider } | null> {
  const tryOne = opts.run ?? ((p: Provider) => tryProvider(p, system, prompt));
  if (process.env.SAM_HEDGE === "0" || pool.length < 2) {
    for (const prov of pool) {
      const text = await tryOne(prov);
      if (text) return { text, prov };
    }
    return null;
  }
  const wait = opts.waitMs ?? HEDGE_MS[lane] ?? HEDGE_MS.fast;
  const inflight = new Map<number, Promise<{ i: number; text: string | null }>>();
  let next = 0;
  const start = () => {
    const i = next++;
    const prov = pool[i];
    inflight.set(i, tryOne(prov).then((text) => ({ i, text })).catch(() => ({ i, text: null })));
  };
  start();
  while (inflight.size) {
    // Race what's running against the hedge timer — but only arm the timer while there is someone
    // left to start, so the last brain in the pool gets its full timeout rather than a busy loop.
    const canStart = next < pool.length && inflight.size < MAX_INFLIGHT;
    let timer: NodeJS.Timeout | undefined;
    const tick = canStart
      ? new Promise<"tick">((r) => { timer = setTimeout(() => r("tick"), wait); })
      : new Promise<"tick">(() => {/* never — nothing left to hedge with */});
    const settled = await Promise.race([...inflight.values(), tick]);
    if (timer) clearTimeout(timer);
    if (settled === "tick") { start(); continue; }
    inflight.delete(settled.i);
    if (settled.text) return { text: settled.text, prov: pool[settled.i] };
    // That one came back empty — bring the next in immediately rather than waiting out the window.
    if (next < pool.length) start();
  }
  return null;
}

async function runModelInner(tier: Tier, system: string, prompt: string, laneHint?: Lane, format?: unknown): Promise<ModelResult> {
  // Local first when asked (free, private, no key).
  if (tier === "local") {
    try {
      const text = await callOllama(system, prompt, OLLAMA_MODEL, format);   // the Grammar constrains local output when a schema is passed
      if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" };
    } catch {
      // A schema `format` an older Ollama rejects must NOT take the local brain down. Retry
      // UNCONSTRAINED — the Grammar degrades gracefully to the Parser's after-the-fact validation,
      // rather than a working local model looking "unavailable". No silent local→cloud crossing.
      if (format) {
        try { const t = await callOllama(system, prompt); if (t) return { text: t, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" }; } catch { /* truly down → fall through */ }
      }
    }
    // PRIVACY GUARANTEE: Private/local mode must NEVER send data to a cloud provider.
    // If the local model isn't up, say so honestly — do not silently go off-machine.
    return {
      text: `🔒 Private mode is on — nothing leaves your Mac — but the local model isn't responding right now. Start it with \`ollama serve\` (and \`ollama pull ${OLLAMA_MODEL}\` if needed), or switch to Auto/Best to use the free cloud brains.`,
      provider: "local-unavailable", tier: "local",
    };
  }

  // ZERO-KEY DEFAULT: if the user has added NO cloud keys and a local Ollama is up with a model,
  // prefer the LOCAL brain — private, offline, instant. It also becomes the floor if the free cloud
  // lanes below all fail. When cloud keys exist, we use the (usually faster/stronger) cloud pool first.
  if (tier !== "premium" && !hasCloudKeys() && await ollamaReady()) {
    // THE GRAMMAR REACHES HERE TOO (when enabled). This is the LOCAL brain answering under a
    // non-local tier, and the constraint belongs to the brain that generates, not to the label on
    // the request — a keyless user asking a "free" question is served by the same llama that the
    // schema exists to constrain. Same graceful degradation as the tier==="local" branch: an Ollama
    // that rejects the schema retries UNCONSTRAINED rather than falling through to the cloud lanes
    // with a working local model in hand.
    try { const text = await callOllama(system, prompt, OLLAMA_MODEL, format); if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" }; }
    catch { /* schema refused or brain hiccuped → unconstrained retry below */ }
    if (format) {
      try { const text = await callOllama(system, prompt); if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" }; } catch { /* fall to free cloud lanes */ }
    }
  }
  // SAM Cloud gateway — if the operator turned it on (SAM_GATEWAY_URL at build) and the user has no
  // keys + no local brain, serve from the hosted free daily allowance before the public no-key lanes.
  if (tier !== "premium" && !hasCloudKeys() && GATEWAY_URL) {
    try { const text = await callGateway(system, prompt); if (text) return { text, provider: "sam-cloud", tier: "free" }; } catch { /* fall to free cloud lanes */ }
  }

  // Walk the cloud tiers. MONEY-SAVER: free/local requests NEVER escalate to
  // paid premium — only an explicit "premium" (Best) request may use paid models.
  const order: Tier[] = tier === "premium" ? ["premium", "free"] : ["free"];
  const lane = laneHint || pickLane(prompt);   // caller can force a lane (e.g. agent tool-planning → deep/Hermes)
  for (const t of order) {
    // Include no-key providers (Pollinations) so there's ALWAYS a free brain to fall to.
    const pool = PROVIDERS.filter((p) => p.tier === t && (poolSize(p.id) > 0 || p.noKey));
    // Free tier: best model for the task FIRST (lane), then spread load across the top few
    // (Oliver Twist) so no single free quota burns out. Still falls through ALL on failure.
    const ranked = t === "free" ? freeOrder(pool, lane) : pool;
    // FREE is hedged, PAID is strictly serial. On the free tier a stalled leader used to own the
    // whole request — every call carries a 30s timeout, so one hung provider cost 30 seconds
    // before the second was even attempted, and the audit found brains taking 11s and 24s to
    // answer or refuse. Now, if the leader hasn't answered within the hedge window, the next one
    // starts ALONGSIDE it and whoever answers first wins. Never on premium: firing two paid calls
    // to save a second is spending the user's money on impatience.
    if (t === "free") {
      const won = await hedged(ranked, system, prompt, lane);
      if (won) return { text: won.text, provider: won.prov.label, tier: t };
    } else {
      for (const prov of ranked) {
        const text = await tryProvider(prov, system, prompt);
        if (text) return { text, provider: prov.label, tier: t };
      }
    }
  }

  // Last resort: local, even if it wasn't the requested tier.
  try {
    const text = await callOllama(system, prompt);
    if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" };
  } catch { /* nothing answered */ }

  return {
    text:
      "I couldn't reach a brain just now — the free lane may be briefly busy, or your internet dropped. " +
      "Give it a few seconds and try again. (SAM is free out of the box — you don't need to add anything. " +
      "If it keeps happening, you can add a free key in Settings 🔑 or run Ollama locally for an offline brain.)",
    provider: "none",
    tier,
  };
}

// Public entry — times the call and records it (tier, tokens, latency) for the router
// badge + benchmark. In bench-mock mode it returns a deterministic answer with no network.
export async function runModel(tier: Tier, system: string, prompt: string, laneHint?: Lane, meta?: { reason?: string; escalated?: boolean; format?: unknown }): Promise<ModelResult> {
  const t0 = Date.now();
  
  if (tier === "premium" && !meta?.escalated) {
    const classTier = classifyPromptTier(prompt);
    if (classTier !== "TIER_2_DEEP_REASON") {
      tier = "free";
    }
  }

  const r = BENCH_MOCK ? await mockRun(tier) : await runModelInner(tier, system, prompt, laneHint, meta?.format);
  const ms = Date.now() - t0;
  const promptTokens = estTokens(system) + estTokens(prompt);
  const outputTokens = estTokens(r.text);
  recordModelCall({ tier: r.tier, provider: r.provider, promptTokens, outputTokens, ms, reason: meta?.reason, escalated: meta?.escalated });
  recordCostSavings({
    provider: r.provider,
    isFreeTier: r.tier === "free" || r.tier === "local",
    inputTokens: promptTokens,
    outputTokens,
    actualCostUsd: costUSD({ tier: r.tier, promptTokens, outputTokens }),
  });
  // The Pulse — self-observability, strictly local.
  count("brain.calls", 1, { tier: r.tier });
  observe("brain.latency_ms", ms, { tier: r.tier });
  count("brain.tokens", promptTokens + outputTokens, { tier: r.tier });
  count("brain.cost_micro", Math.round(costUSD({ tier: r.tier, promptTokens, outputTokens }) * 1e6)); // micro-USD, integer
  mark("brain", `${r.tier} · ${r.provider}`);
  return r;
}

// ── STREAMING · token-by-token for the "types as it thinks" feel ──
export function localStaysOnDevice(tier: Tier): boolean { return tier === "local"; }

/**
 * Does the Grammar actually REACH the brain that will answer this turn?
 *
 * It used to be assumed equal to `tier === "local"`, and that assumption was wrong in the one
 * configuration a keyless user runs: with no cloud keys loaded, a "free" request is served by the
 * SAME local Ollama (the zero-key path in runModelInner), unconstrained — so the schema that exists
 * to stop a small model emitting its deliberation was dark exactly where it was needed. That is how
 * raw planning text reached a user's screen on 2026-08-12.
 *
 * MEASURED 2026-08-12, llama3.2:3b, and the zero-key half STAYS OFF on the evidence. The schema is
 * accepted (33 KB, 189 oneOf branches, honored 4/4 — Ollama compiles it fine) and a constrained turn
 * finishes FASTER in isolation, 6.0s → 2.6s median. That number is a trap: it is faster because it
 * emits a tool CALL instead of an answer, and a call is not a cheap answer, it is another round trip.
 * End to end through runAgentStream, tier "free", no keys:
 *
 *   "what makes you different from a cloud assistant?"  off 33.0s / 0 steps, correct
 *                                                        ON 44.2s / 4 steps — went off and PAINTED AN
 *                                                        IMAGE, then answered about generated PNGs
 *   "what is the time right now?"                        off 23.0s / 2 steps · ON 25.4s / 4 steps
 *   "write me a haiku"                                   tie — the fast path skips the loop entirely
 *
 * With 188 tool branches against a single {respond} branch, the grammar makes a tool call the easy
 * thing to fall into, and a 3B model falls into it every time. The constraint fixes the SHAPE of a
 * turn while wrecking the CHOICE of it. Re-measure per model before flipping this — it is a property
 * of the brain, not of the code. The Curtain does not depend on the constraint reaching anything,
 * which is why it, and not this, is what guarantees the user never sees scaffolding.
 */
export async function grammarReaches(tier: Tier): Promise<boolean> {
  if (tier === "local") return true;
  if (process.env.SAM_GRAMMAR_ZEROKEY !== "1") return false;
  return tier !== "premium" && !hasCloudKeys() && await ollamaReady();
}

async function streamModelInner(tier: Tier, system: string, prompt: string, onChunk: (t: string) => void, laneHint?: Lane, format?: unknown): Promise<ModelResult> {
  // THE GRAMMAR on streaming: a constrained turn streams straight from the local Ollama with the schema.
  // Cloud brains don't take the Ollama `format`, so this is LOCAL-only (like the non-streaming grammar).
  // An older Ollama that rejects the schema falls through to the normal path (unconstrained) — no dead brain.
  if (format) {
    try { const text = await callOllamaStream(system, prompt, OLLAMA_MODEL, format, onChunk); if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" }; }
    catch { /* fall through to the normal streaming path */ }
  }
  // PRIVACY GUARANTEE (audit fix): Private/local mode must NEVER reach a cloud brain — the
  // same promise runModelInner makes. The streaming path used to fall through to the Groq/
  // Gemini branch below for tier "local", because it only excluded "premium". Local streams
  // from the local Ollama; if that is down it defers to runModelInner's honest "Private mode
  // is on — nothing leaves your Mac" message rather than crossing the boundary to cloud.
  if (localStaysOnDevice(tier)) {
    try { const text = await callOllamaStream(system, prompt, OLLAMA_MODEL, undefined, onChunk); if (text) return { text, provider: `ollama:${OLLAMA_MODEL}`, tier: "local" }; }
    catch { /* local down → honest local-unavailable via runModelInner below, never cloud */ }
    const r = await runModelInner(tier, system, prompt, laneHint);
    onChunk(r.text);
    return r;
  }
  const tryStream = async (id: string, run: (key: string) => Promise<string>, label: string): Promise<ModelResult | null> => {
    // Route the stream through the Relay (Breaker + boundary + key pool + failure capture), capped
    // at ONE key — a stream that already emitted tokens can't be retried without double-emitting.
    // system/prompt/onChunk are bound in `run`, so the Relay just manages the outcome. On by
    // default now the Relay is proven; SAM_RELAY=0 is the kill-switch back to the plain path.
    if (process.env.SAM_RELAY !== "0") {
      const r = await relayBrain({ id, boundary: "cloud", run: (_s, _p, key) => run(key) }, system, prompt, { allowCloud: true }, { maxKeys: 1 });
      return r.ok ? { text: r.value, provider: label, tier: "free" } : null;
    }
    if (!poolSize(id)) return null;
    const key = getKey(id); if (!key) return null;
    try { const text = await run(key); if (text) { reportSuccess(id, key); return { text, provider: label, tier: "free" }; } }
    catch (e: any) { reportFailure(id, key, e?.status); }
    return null;
  };
  if (tier !== "premium") {
    const g = await tryStream("groq", (k) => streamOpenAICompat("https://api.groq.com/openai/v1", GROQ_MODEL, system, prompt, k, onChunk), `groq:${GROQ_MODEL}`);
    if (g) return g;
    const gem = await tryStream("gemini", (k) => streamGemini(system, prompt, k, onChunk), "gemini-2.5-flash");
    if (gem) return gem;
  }
  // fallback: non-streamed, emit whole text once (respects a forced lane, e.g. deep/Hermes)
  const r = await runModelInner(tier, system, prompt, laneHint);
  onChunk(r.text);
  return r;
}

// Public streaming entry — records ttft + total latency for the badge + benchmark.
// Bench-mock: emit the deterministic answer in two chunks with a modelled TTFT.
export async function streamModel(tier: Tier, system: string, prompt: string, onChunk: (t: string) => void, laneHint?: Lane, meta?: { reason?: string; escalated?: boolean; format?: unknown }): Promise<ModelResult> {
  const t0 = Date.now();
  
  if (tier === "premium" && !meta?.escalated) {
    const classTier = classifyPromptTier(prompt);
    if (classTier !== "TIER_2_DEEP_REASON") {
      tier = "free";
    }
  }

  let ttft = 0;
  const wrap = (t: string) => { if (!ttft) ttft = Date.now() - t0; onChunk(t); };
  let r: ModelResult;
  if (BENCH_MOCK) {
    await sleep(Math.round(MOCK_LATENCY[tier] * 0.4));   // time-to-first-token < total
    const txt = mockText(tier);
    const mid = Math.floor(txt.length / 2);
    wrap(txt.slice(0, mid));
    await sleep(Math.round(MOCK_LATENCY[tier] * 0.6));
    wrap(txt.slice(mid));
    r = { text: txt, provider: `mock:${tier}`, tier };
  } else {
    r = await streamModelInner(tier, system, prompt, wrap, laneHint, meta?.format);
  }
  recordModelCall({
    tier: r.tier, provider: r.provider,
    promptTokens: estTokens(system) + estTokens(prompt),
    outputTokens: estTokens(r.text),
    ms: Date.now() - t0, ttftMs: ttft || undefined, reason: meta?.reason, escalated: meta?.escalated,
  });
  return r;
}

// ── VISION · look at photos/images (free via Gemini multimodal) ──
export interface ImagePart { mime: string; data: string } // data = raw base64

// Groq's vision guardrail frequently refuses perfectly benign photos — especially ones
// with a person/face — returning a canned "I can't help with that." Treat that (and a
// blank reply) as a MISS so we fall through to a real vision lane instead of surfacing
// the refusal to the user. Kept local so this low-level module stays dependency-free
// (mirrors classify.ts's selfCheckFailed).
const VISION_REFUSAL_RE = /i can[’'`]?t (help|assist)|i(?:'?m| am)? ?(?:un)?able to (?:help|assist|process)|i cannot (?:help|assist|process)/i;
function visionRefused(text: string): boolean {
  const a = (text || "").trim();
  return a.length < 8 || VISION_REFUSAL_RE.test(a);
}

export async function runVision(system: string, prompt: string, images: ImagePart[]): Promise<ModelResult> {
  // LANE 0 · Groq llama-4-scout (free tier, very fast) — vision without a Gemini key.
  {
    const gk = getKey("groq");
    if (gk) {
      try {
        const content: any[] = [{ type: "text", text: prompt || "Describe this and answer any question about it." },
          ...images.slice(0, 4).map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))];
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${gk}` },
          signal: AbortSignal.timeout(45000),
          body: JSON.stringify({ model: process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct", max_tokens: 1500, messages: [{ role: "system", content: system }, { role: "user", content }] }),
        });
        if (r.ok) {
          const text = (await r.json())?.choices?.[0]?.message?.content?.trim() || "";
          // Only accept a real answer — if Groq refused/blanked, fall through to Gemini/Ollama.
          if (text && !visionRefused(text)) { reportSuccess("groq", gk); return { text, provider: "groq:llama-4-scout (vision)", tier: "free" }; }
        } else reportFailure("groq", gk, r.status);
      } catch { /* fall through to Gemini */ }
    }
  }
  const attempts = Math.max(1, poolSize("gemini"));
  for (let i = 0; i < attempts; i++) {
    const key = getKey("gemini");
    if (!key) break;
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
      const parts: any[] = [{ text: prompt || "Describe this and answer any question about it." },
        ...images.map((im) => ({ inline_data: { mime_type: im.mime, data: im.data } }))];
      const r = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (!r.ok) { const e: any = new Error(`gemini ${r.status}`); e.status = r.status; throw e; }
      const d = await r.json();
      const text = d?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
      if (text) { reportSuccess("gemini", key); return { text: text.trim(), provider: "gemini-2.5-flash (vision)", tier: "free" }; }
    } catch (e: any) { reportFailure("gemini", key, e?.status); }
  }
    try {
      const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
      const ollamaModel = process.env.OLLAMA_VISION_MODEL || "llava";
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          stream: false,
          messages: [
            { role: "system", content: system },
            { 
              role: "user", 
              content: prompt || "Describe this and answer any question about it.",
              images: images.map(im => im.data) 
            },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const text = data?.message?.content?.trim() || "";
        if (text) {
          return { text, provider: `ollama (${ollamaModel})`, tier: "local" };
        }
      }
    } catch (_e: any) {
      // Fall through to the offline message below if Ollama fails/isn't running
    }

  return { text: "To read photos, SAM needs a free Gemini key (add GEMINI_API_KEYS to .env) or Ollama running with the 'llava' model locally. Everything else works without it.", provider: "none", tier: "free" };
}

// For the HUD / status endpoint: which providers are wired.
export function providersStatus() {
  return {
    local: { ollama: OLLAMA_MODEL },
    pools: keyStatus(),
    providers: PROVIDERS.map((p) => ({ id: p.id, tier: p.tier, keys: poolSize(p.id) })),
    arena: (() => { const r = loadRanking(); if (!r) return null; const stale = rankingStale(r.ts, Date.now()); return { top: r.top, ts: r.ts, stale, steering: !stale }; })(),   // colosseum champion; steering only while fresh
  };
}

// ── Model Colosseum support ──
// The brains usable RIGHT NOW (have a key, or need none) — the arena's eligible competitors.
export function availableBrains(): { id: string; tier: Tier; label: string }[] {
  return PROVIDERS.filter((p) => p.noKey || poolSize(p.id) > 0).map((p) => ({ id: p.id, tier: p.tier, label: p.label }));
}
// Run ONE named brain directly (bypasses the cascade) so distinct models can go head-to-head.
export async function runBrain(id: string, system: string, prompt: string): Promise<string | null> {
  const prov = PROVIDERS.find((p) => p.id === id);
  return prov ? tryProvider(prov, system, prompt) : null;
}
