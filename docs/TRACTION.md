# SAM — Traction

*Template. Fill the bracketed numbers once launched with opt-in telemetry. Empty today, by design —
this branch makes traction **measurable**; it does not create it. The one act that does is launching.*

## The numbers an acquirer / investor reads

| Metric | Source | Today | Target (90d post-launch) |
|---|---|---|---|
| **Installs** | GitHub releases + package managers | 0 | [ ] |
| **Activation rate** (install → first successful task) | opt-in `activated` | — | > 40% |
| **DAU / WAU** | opt-in `dau` pings | — | [ ] / [ ] |
| **D1 / D7 / D30 retention** | opt-in `retentionBucket` | — | [ ] / [ ] / [ ] |
| **Stickiness** (DAU/MAU) | derived | — | > 20% |
| **Feature → retention correlation** | `features` counts × retention | — | *which features D30-users use* |
| **Crash-free rate** | opt-in `crashFree` | — | > 99% |
| **CAC** | — | **~$0** | ~$0 (organic / word-of-mouth / awesome-lists / HN) |
| **Cloud conversion** | billing (if enabled) | — | ~3% (assumption to validate) |

## The story, in the language they use

- **Distribution: CAC ≈ 0.** Growth is organic — HN, Reddit (r/LocalLLaMA), awesome-lists, the ⌥Space
  overlay is inherently demo-able, and packs are shareable (built-in virality). No ad spend modeled.
- **Retention is the moat, and it compounds privately.** Workflows are switching cost; on-device learning
  makes week 4 better than week 1; the more of a user's world SAM indexes locally, the more it costs them
  (in their favor) to leave. No cloud competitor can copy "it learns you *on your device*."
- **Near-zero marginal cost** (see BUSINESS.md) → the growth curve isn't a burn curve.
- **Ecosystem** — a versioned pack platform + SDK turns users into contributors and contributors into
  marketing.

## How to read this file honestly

If the bracketed numbers are strong (D30 > 20%, activation > 40%, DAU growing), SAM is a real, defensible,
cheap-to-run business and the valuation follows the retention curve. If they're weak, the product is loved
by few and the honest move is to fix activation/retention before monetizing. **Either way, you can't know
until you launch — so the highest-value action is not editing this file, it's generating the data for it.**
