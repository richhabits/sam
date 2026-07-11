# SAM — The Feedback Loop

How SAM tells you what to build next, so you stop guessing. Three channels, all privacy-safe, feeding one
decision: *build what retains users, not what you assume.*

## 1. Opt-in aggregate signal → your private roadmap

Builds on the v2.0 telemetry model (`server/telemetry.ts`, `docs/PRIVACY.md`): **off by default, anonymous,
whitelist-only, content can never be sent.** If a user opts in, you receive aggregate counts — which
features get used, which fail, where activation drops.

What you read from it (once the endpoint is deployed — see ONLY-YOU):
- **Activation:** what % of installs complete a first successful task, and where the rest stall.
- **Feature → retention:** which `features` counts are high among `retentionBucket: d30+` users. Build those.
- **Failure hotspots:** if `crashFree` dips or a setup step correlates with drop-off, fix that first.

This never sees content. It answers "*do people stay, and what do stayers use?*" — the only questions that
should drive the roadmap.

## 2. Public feedback, self-surfacing (GitHub Discussions)

Enable **Discussions** (repo Settings → Features → Discussions) with these categories so the loudest real
needs surface themselves:

| Category | Format | Purpose |
|---|---|---|
| **Q&A** | question/answer | Support that helps the next person (issue `config.yml` routes here) |
| **Ideas** | open + 👍 | Feature requests; upvotes rank them |
| **Show & tell** | open | Packs/workflows people built — social proof + flywheel |
| **Announcements** | maintainer-only | Releases |

The Ideas board with visible upvotes *is* the public roadmap — you build with evidence, not intuition.

## 3. The monthly auto-digest

`.github/workflows/monthly-digest.yml` opens a draft issue on the 1st: stars, merged PRs (incl. packs),
top-👍 feature requests, open bugs, and any health alerts. The state of SAM, assembled for you — so a
glance tells you where to point your scarce hours.

## The loop, closed

Users (opt-in signal) + public (Discussions 👍) + the digest → **one prioritized view of what to build**,
grounded in what actually keeps people. Your judgment still makes the call — but on evidence, not guesses.
That's the automation that compounds: every month the loop gets sharper without you assembling it.
