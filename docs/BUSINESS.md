# SAM — Business Model & Unit Economics

*Internal / for evaluation. Honest numbers, not a pitch deck.*

## The model in one line

**Free, local, private core — forever. Money comes only from things that cost us money to run, or that
only some users want.** Nothing that works on the user's own machine is ever paywalled. This is enforced
in code (`billing.ts` → `coreGated()` is a typed-false tripwire with a test).

## Why the economics are unusually good

SAM is **local-first**, so the marginal cost of a normal user is **~$0**: they run on their own machine,
their own Ollama, or free cloud tiers with their own keys. We don't pay for their inference, storage, or
bandwidth. That inverts the usual AI-app problem (every user costs you GPU money). Here, **most users are
free to us as well as free to them.**

We only incur cost for users who choose **SAM Cloud** — the optional hosted gateway that gives zero-setup
brains to people who won't touch keys or run a local model. Those users cost us inference, and that's
exactly what we charge for.

## Revenue lines

| Line | Who pays | Why it's fair | Status |
|---|---|---|---|
| **SAM Cloud** ($8/mo, generous free tier below) | People who want zero-setup hosted brains | Costs us inference $$ to run | scaffolded, off |
| **Supporter** ($5/mo) | People who love SAM and want it to survive | Funds the project; paywalls nothing | scaffolded, off |
| **SAM Teams** (future) | Orgs wanting shared packs/workflows, admin, registry | Classic free-for-individuals / paid-for-teams (Cursor, Linear, Obsidian) | shape only |

## SAM Cloud unit economics (the only cost line)

Assumptions (deliberately conservative; swap for real once measured):
- A SAM Cloud user makes ~15 model calls/day of ~1k tokens on cheap/free-tier-pooled models.
- Blended inference cost to us: **~$0.10 / active Cloud user / month** (pooled cheap models + heavy
  cache-hit rate — SAM's cascade router already serves ~100% free-or-local on benchmark, so Cloud paid
  calls are the exception, not the rule).
- Fixed infra (a Cloudflare Worker gateway + KV): **~$5–25/mo flat**, independent of scale (the gateway
  already exists with per-device + global caps + kill-switch).

| Scale (total installs) | Cloud subs @ 3% | Cloud cost/mo | Cloud revenue/mo | Net (Cloud only) |
|---|---:|---:|---:|---:|
| 1,000 | 30 | ~$3 + $25 infra | $240 | **+$212** |
| 10,000 | 300 | ~$30 + $25 | $2,400 | **+$2,345** |
| 100,000 | 3,000 | ~$300 + $50 | $24,000 | **+$23,650** |

The non-Cloud 97% cost us **nothing** — they're the moat and the funnel, not a liability. Add supporter
revenue (even 1% at $5) on top, which is ~pure margin.

## What makes SAM self-funding vs. profitable

- **Self-funding** (covers infra + a maintainer's time, say ~$3–4k/mo) happens around **~10k installs**
  at a 3% Cloud conversion — *if* people convert at that rate. That's the number to watch.
- **Profitable** is a scale + conversion question, not a cost question — because costs stay near-flat.
  At 100k installs and 3% Cloud + 1% supporter, it's a small but real software business with ~90%+ margin.

## The honest risks

1. **Conversion is unproven.** We have zero users and zero telemetry today, so 3% is a guess. The v2.0
   measurement layer exists precisely to replace this guess with a real number.
2. **Free-tier generosity vs. conversion.** If the local/free path is *too* good, few need Cloud. That's
   fine — it means low cost and a strong moat — but it caps Cloud revenue. Supporter + Teams then matter more.
3. **The whole thing is gated on ONE input: users.** See `TRACTION.md`. No users → no business, regardless
   of how clean this model is.

## What a buyer is actually buying

Not the code (it's MIT). A buyer is buying: a **retained user base**, a **privacy-differentiated brand**
in a crowded AI market, a **near-zero-marginal-cost** distribution, and an **ecosystem** (packs) that
compounds. All of which require the one thing this branch cannot create: **launching and keeping users.**
