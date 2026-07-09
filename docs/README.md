# SAM docs

Everything a skeptical reader clicks before starring.

- **[Quickstart](../README.md#quick-start)** — one-paste install, or run from source (~60s to a working assistant, no keys).
- **[Packs gallery](PACKS.md)** — ready-made bundles of skills, prompts and (safety-gated) tools. Import, review, done.
- **[Benchmarks](BENCHMARKS.md)** — reproducible v1.3→v1.5 numbers: ~86% cheaper, ~46% faster, 100% free-or-local. Run `npm run bench` yourself.
- **[Security](../SECURITY.md)** — the trust model: local-first, ask-first dangerous tools, injection fencing, the forge sandbox, opt-in encryption, scoped remote tokens.
- **[Gateway](GATEWAY.md)** — the optional capped free-tier (your infra); exactly what it can and can't see.
- **[Signing](SIGNING.md)** — why builds are unsigned for now, and how to verify checksums.

## The 60-second pitch
SAM is a free, private, MIT-licensed AI that runs on your own machine and *does the work* — web, files, terminal, email, GitHub. A cascade router sends each request to the cheapest brain that fits (your local model first), so most tasks cost nothing. It caches repeat answers instantly, indexes the folders you choose (on-device, cited), can be summoned system-wide with ⌥Space to act on your selection in any app, and safely writes its own tools when it lacks one. No subscription, no telemetry.

## How it works (one diagram in words)
`your message → cascade classifier (≈0ms, local) → cheapest tier that fits → [semantic cache? → 2ms/0 tokens] → agent loop (170+ tools, dangerous ones ask first) → answer, with the source file / tier badge shown`
