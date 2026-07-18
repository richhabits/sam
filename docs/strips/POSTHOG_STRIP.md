# Stripping PostHog — anything useful for SAM / FLIP IT?

*Source: [PostHog/posthog](https://github.com/PostHog/posthog) — the open-source product
analytics platform (analytics, session replay, feature flags, experiments, surveys, data
warehouse, error tracking, LLM observability). MIT (with an `ee/` proprietary dir).
~complex Django + ClickHouse + React monolith built for multi-tenant cloud scale.*

## Headline verdict

**SAM has already built PostHog's best idea — privately, and stricter.** PostHog's core
value is "own your product analytics instead of renting Google's." SAM's `server/telemetry.ts`
+ `consent.ts` + `analytics.ts` + `crashlog.ts` already do this, and go *further* than PostHog
on the one axis that matters most to SAM's users: **content can never leave the device.**
PostHog's LLM observability explicitly "captures complete conversation context (inputs and
outputs)"; SAM's telemetry is a **closed whitelist** where prompts/paths/inputs are structurally
un-sendable (`ALLOWED_FIELDS`, `isSendable`). So most of PostHog is either already present or
philosophically off-limits. What's left worth taking is **narrow and specific** — two things.

## Nicked — the two that are genuinely new

| PostHog idea | Where it maps | Artifact |
|---|---|---|
| **Experiments: don't declare a winner without significance** ([docs](https://posthog.com/docs/experiments/statistics)) | the **Colosseum** crowns `leaderboard[0]` by raw Elo — with ~18 matches across many brains, a 25-Elo gap is usually noise, so the champion flips night-to-night and churns routing | `colosseum-significance.ts` (built + verified): a two-proportion z-test gate; re-crown only when the leader is *significantly* ahead of #2, else keep the incumbent |
| **AI/LLM observability: per-generation cost / latency / tokens / errors** ([docs](https://posthog.com/docs/ai-observability/start-here)) | SAM routes across ~40 brains (`models.ts` has pricing; `routing.ts`/`classify.ts` pick) but doesn't surface *your* cost/latency/failure per brain | proposed: a **local-only** generation log → a "my AI usage" self-analytics view. Local-only is the whole point — PostHog ships prompts to a server; SAM must not |

### The significance gate — and where SAM beats PostHog

PostHog's own docs admit a real weakness: *"PostHog tests each metric independently and doesn't
adjust for [multiple comparisons] … the false positive rate rises to ~23%."* The Colosseum has
the same latent trap — it picks the **max** of N brains (a winner's-curse selection) and treats
the raw ranking as truth. So the port doesn't just copy PostHog, it **fixes what PostHog skips**:
the gate is Bonferroni-adjusted by the number of brains. Verified (`verify_significance.mjs`,
4/4): a clear 90%-vs-50%@20-games leader crowns (z=3.07); a noisy 55%-vs-50%@20 does not
(z=0.32); <8 games never crowns; tie-heavy strong leads over enough games still separate.

## FLIP IT — one honest finding, and otherwise nothing

Almost all of PostHog (analytics, replay, flags, surveys, warehouse) is irrelevant to a £5
trading rig. But **one thing transfers, and it's a caution, not a feature:**

PostHog Experiments has the **peeking problem** unsolved (checking results repeatedly inflates
false positives; their docs don't use sequential testing). FLIP IT's forward gate checks a
**fixed 2σ band every single day** for 60 days — that is *exactly* the same latent trap: ~60
looks at a 2σ band will breach by chance far more than 5% of the time under the null, so an
honest strategy can get bounced (or a dead one pass) on multiple-comparisons noise. The fix is
**always-valid inference** — a confidence *sequence* (Howard et al. 2021) or mSPRT that stays
valid under continuous monitoring — which PostHog notably does **not** implement, so we'd be
taking the lesson from their gap, not their code. **This touches the forward gate (law), so it's
a finding for Romeo, not a change** — filed as a note, not an amendment. Everything else PostHog
does: binned for flip-it.

## Binned (with reasons)

- **Session replay** — record & replay user sessions. No SAM UI to replay, and recording a
  user's screen is the antithesis of local-first privacy. Hard no.
- **Data warehouse / CDP / pipelines / 25+ destinations** — SAM is single-user local-first; this
  is multi-tenant-cloud plumbing for the opposite problem.
- **Autocapture** — capture every click automatically. Convenient, but "capture everything by
  default" is precisely the posture SAM's whitelist exists to refuse.
- **ClickHouse / Django / Celery / the whole scale stack** — SAM stores state in JSON files and
  a small vault; importing PostHog's infra would be strapping a data-centre to a bicycle.
- **Surveys, web analytics** — not SAM's product.

## What SAM already has (so we don't rebuild it)

`telemetry.ts` (opt-in, anonymous, aggregate, whitelist-only) · `consent.ts` · `analytics.ts`
(local product analytics) · `metrics.ts` · `crashlog.ts` (≈ PostHog error tracking) ·
`colosseum.ts` (≈ Experiments, for brains) · `models.ts` (per-model pricing). PostHog validated
that these are the right primitives — SAM just built them small, local, and private-by-default.

## BOARD paste block

```
- PostHog stripped (POSTHOG_STRIP.md): SAM already has its core (telemetry/consent/crashlog/
  colosseum), and stricter on privacy. Two real ports: (1) colosseum-significance.ts — z-test
  gate so the champion only re-crowns on real evidence, Bonferroni-adjusted (fixes the multiple-
  comparisons trap PostHog admits it has); built + verified 4/4, unwired (server/ is shared).
  (2) local-only per-brain cost/latency observability — proposed. FLIP IT finding: the forward
  gate's daily 2σ check has the peeking problem; fix = always-valid confidence sequence — a
  note for Romeo (touches the gate = law), not a change.
```
