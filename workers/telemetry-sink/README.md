# SAM telemetry sink

The receiving end of SAM's opt-in aggregate heartbeat (`server/telemetry.ts` → `postTelemetry`).
**Committed but not deployed.** Nothing sends and nothing receives until *both* of these are true:

1. This worker is deployed, and
2. the SAM build points at it via the `TELEMETRY_ENDPOINT` env var.

Until then every SAM install returns `"no-endpoint"` and phones home nothing — the default.

## What it accepts

Exactly the closed whitelist the client enforces (`ALLOWED_FIELDS` / `ALLOWED_FEATURES` in
`server/telemetry.ts`): `schema, anonId, version, os, dau, retentionBucket, activated, crashFree, features{tasks,toolUses,workflowRuns,cacheHits}`.
Anything off-whitelist is rejected with `400` and stored nowhere. No field is free text; nothing
identifies a person. See `docs/PRIVACY.md`.

## Deploy (when there are users to learn from)

```sh
cd workers/telemetry-sink
wrangler kv namespace create SAM_TELEMETRY          # then paste the id into wrangler.toml + uncomment
wrangler deploy                                     # → https://sam-telemetry-sink.<subdomain>.workers.dev
```

Then set the client endpoint for a release build:

```sh
TELEMETRY_ENDPOINT="https://sam-telemetry-sink.<subdomain>.workers.dev" npm run build
```

Without the KV namespace the worker still deploys and validates, but accepts-and-drops (no storage) —
safe to stand up first and wire storage later.

## Read the signal

Aggregate records are keyed `YYYY-MM-DD:<anonId>`, TTL 90 days. Count distinct `anonId`s per day for DAU;
bucket by `retentionBucket` and cross-tab against `features` counts to see *what stayers use* — the only
question that should drive the roadmap (`docs/ROADMAP-SIGNAL.md`).
