# Supporter tier (optional, off by default)

SAM is free, local, and private **forever**. This document describes a *possible* way SAM could fund
itself without breaking any of that — scaffolded behind the `SAM_SUPPORTER` flag, shipped **OFF**. It is
the operator's decision whether to ever turn it on.

## The rules it can never break

1. **Never paywalls core function.** Everything SAM does today stays free. Enforced by `coreFeatureGated()`
   in `server/supporter.ts` — a `false` tripwire guarded by a test.
2. **Never adds telemetry.** The supporter path sends nothing about you, anywhere. The zero-telemetry
   promise is absolute.
3. **Only optional extras.** Perks are things that cost the operator real money to provide — never things
   your own machine already does for free.

## What a supporter tier *could* be

- **Higher hosted-gateway limits** — the optional pooled free-tier brain (off by default) has per-device
  and global caps. A supporter could get a higher cap. Anyone can still add their own free key for
  unlimited use at zero cost, so this paywalls nothing.
- **Priority pack curation** — faster review of your submissions to the community index.

Both are *conveniences the operator pays to run*, not locks on features.

## What it must never be

- No "pro" model behind a paywall (SAM is brain-agnostic; bring any key).
- No feature that works locally being gated.
- No account requirement for core use.
- No data collection, ever.

If a proposed supporter perk fails any of these, it doesn't ship. The flag exists so the option is
*designed correctly in advance* — not bolted on under pressure later.
