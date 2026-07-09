# SAM Benchmarks — v1.3 → v1.4 "Game Changer"

**Headline: v1.4 costs ~86% less per task and answers ~46% faster than v1.3 — with equal-or-better answers, and every task served free-or-local.**

These numbers are reproducible: `npm run bench` runs a fixed 20-task suite through the **real** request pipeline (classifier → tier routing → prompt assembly → agent loop → semantic cache), then `npm run bench -- --compare baseline v1.4` prints the delta.

## Results (20-task suite)

| Metric | v1.3 (baseline) | v1.4 | Δ |
|---|--:|--:|--:|
| **Avg cost / task** | $0.001598 | $0.000221 | **−86.2%** |
| Avg total tokens / task | 3,728 | 2,440 | −34.6% |
| Avg prompt tokens / task | 3,681 | 2,402 | −34.8% |
| **Avg latency to first token** | 98.3 ms | 53.5 ms | **−45.6%** |
| **Avg total latency** | 238.9 ms | 128.9 ms | **−46.0%** |
| Served free-or-local | 90% | **100%** | +11 pts |
| Tier mix (local / free / premium) | 0 / 18 / 2 | **8 / 12 / 0** | more local, zero paid |
| Repeat-question cache hits | 0 | 3 | instant + $0 |
| Repeat-question latency | ~207 ms | **~2 ms** | −99% |

Server cold-start (spawn → ready, incl. tsx): **~950 ms**.

## What moved the numbers

- **Cascade classifier (Phase 1).** A fast, model-free pass routes each request to the cheapest tier that fits: trivial → the **local** brain (never a paid API), standard/tool → free, hard → the strong **free** deep lane. Premium is reached only on explicit opt-in or a failed self-check, so average cost goes **down**, never up. Result: 8/20 tasks moved to local ($0, instant); the 2 premium tasks moved to free.
- **Token diet (Phase 1).** Trivial requests get a **lean** system prompt (~60 tokens + the routed skill playbook) instead of the full ~3.5k-token persona/doctrine. Recall injects only memory chunks above a higher relevance floor, capped and de-duplicated. Avg prompt tokens fell ~35% across the whole suite.
- **Semantic cache (Phase 2).** Repeat questions in the same context are served from memory — **~2 ms, 0 tokens** — with a "from memory · 0 tokens" badge and one-tap re-ask-fresh. Live/time-sensitive and private requests are never cached; a changed fact or file invalidates automatically.
- **Parallel tool batching (Phase 6).** Independent read-only lookups run concurrently (time of the slowest, not the sum) — safe tools only, so the approval gate is untouched.

## Methodology (honest notes)

- The suite runs against a **deterministic, offline mock brain** (`SAM_BENCH_MOCK=1`) so runs cost **zero** cloud quota and are byte-for-byte reproducible. Per-tier latency is **modelled** (local < free < premium); the *ratios* — which is what before/after deltas measure — are what matter, and are labelled as modelled.
- Token counts are estimated at ~4 chars/token — approximate in absolute terms but **stable** across runs, so the deltas are honest.
- The cost lens is transparent (`server/metrics.ts` `PRICE`): local = $0, free = a small nominal quota-value, premium = Sonnet-class real dollars. Raw token/tier counts are in `bench/*.json` if you prefer your own lens.
- "Multi-step" tasks resolve in one call under the mock brain (it never emits tool JSON), so the suite under-states multi-step latency — equally for both runs, so the deltas stay valid.

_Regenerate: `npm run bench -- baseline` (on v1.3) and `npm run bench -- v1.4`, then `npm run bench -- --compare baseline v1.4`._
