# SAM Cloud gateway — optional hosted free tier

**Status: built, documented, and OFF in the public build.** SAM never ships a key and never points at a
gateway unless *you* build the client with `SAM_GATEWAY_URL` set. This doc is how it works, how to
deploy it, and what it costs — so you can flip it on if/when you want.

## What it is

A tiny Cloudflare Worker (`gateway/`) that lets brand-new installs talk to cloud AI **instantly, with
no key and no signup** — by proxying to a pool of provider keys *you* hold in the Worker's secrets. The
app stays keyless; the keys live only on your Worker.

Hard cost controls are built in and enforced server-side:
- **Per-device daily cap** (`PER_DEVICE_DAILY`, default 50 calls/day)
- **Global daily cap** (`GLOBAL_DAILY`, default 20 000 calls/day)
- **Cheap-models-only whitelist** (`MODEL_WHITELIST`) — the client can't request anything pricier
- **Abuse blocklist** (`block:<device>` KV key) + **hard kill-switch** (`SPEND_CEILING_CALLS`)
- **Anonymous device id** — a random per-install id (no personal data), so the zero-telemetry promise holds

When a user hits their allowance, SAM nudges them to add their own free key (Phase 3 wizard) for
unlimited use, and falls through to the public no-key lanes meanwhile — it never goes dark.

## Deploy (≈10 minutes)

```bash
cd gateway
npm install
npx wrangler kv namespace create QUOTA      # paste the id into wrangler.toml
npx wrangler secret put PROVIDER_KEYS        # paste: key1,key2,key3  (your pooled free/paid keys)
# tune [vars] in wrangler.toml (UPSTREAM_URL, MODEL_WHITELIST, caps)
npm run deploy                               # → https://sam-gateway.<you>.workers.dev
```

Then build SAM clients with the flag on:
```bash
SAM_GATEWAY_URL=https://sam-gateway.<you>.workers.dev npm run build
```
New installs now get **"SAM Cloud (free daily allowance)"** as a pool member automatically. The app
reads remaining quota from `/api/gateway/quota` and displays it. Leave the env unset (the default) and
the gateway path is completely inert.

## Cost estimates

Two things cost money: the Cloudflare Worker (basically free — 100 000 requests/day on the free plan,
then $0.30/M) and the **upstream tokens**. The daily caps are what *bound* your spend — assume ~500
tokens/call average and the default caps:

| Users | Calls/day (capped) | Tokens/day | On **free** provider tiers | On **paid** small models (~$0.08/M) |
|---|---|---|---|---|
| **100** | ~5 000 | ~2.5 M | **$0** (fits pooled free quotas) | ~$6/mo |
| **1 000** | ~20 000 (hits global cap) | ~10 M | free quotas exhaust → throttled | **~$24/mo** (bounded by `GLOBAL_DAILY`) |
| **10 000** | ~20 000 (global cap holds) | ~10 M | throttled to the cap | **~$24/mo** (same — the cap is the ceiling) |

The headline: **the global daily cap fixes your worst-case cost regardless of user count.** Raise
`GLOBAL_DAILY` to serve more; `SPEND_CEILING_CALLS` is the absolute hard stop. Start conservative.

## Privacy

The gateway sees only: the anonymous device id, the model, and the prompt (which it must forward to the
provider to answer). It stores **counters only** (device→count, day→count) in KV with a daily TTL — no
prompts, no content, no personal data logged. Same privacy posture as the rest of SAM.
