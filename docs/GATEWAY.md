# SAM Cloud gateway — optional hosted free tier

**Status: built, documented, and OFF in the public build.** SAM never ships a key and never points at a
gateway unless *you* build the client with `SAM_GATEWAY_URL` set. This doc is how it works, how to
deploy it, and what it costs — so you can flip it on if/when you want.

## What it is

A tiny Cloudflare Worker (`gateway/`) that lets brand-new installs talk to cloud AI **instantly, with
no key and no signup** — by proxying to a pool of provider keys *you* hold in the Worker's secrets. The
app stays keyless; the keys live only on your Worker.

Hard cost controls are built in and enforced server-side:
- **Per-device daily cap** (`PER_DEVICE_DAILY`) — **soft-beta default: 15 calls/day**
- **Global daily cap** (`GLOBAL_DAILY`) — **soft-beta default: 3 000 calls/day**
- **Cheap-models-only whitelist** (`MODEL_WHITELIST`) — the client can't request anything pricier
- **Abuse blocklist** (`block:<device>` KV key) + **cumulative spend ceiling** (`SPEND_CEILING_CALLS`, soft-beta ~60 000 ≈ **$25/mo cap**)
- **INSTANT kill-switch** (`PAUSED=1`) — pauses the whole gateway immediately, no redeploy; SAM falls back to its own free lanes so no one is stranded
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

## Kill-switch test (do this before the beta goes live)

```bash
cd gateway
npx wrangler deploy
# pause instantly:
npx wrangler secret put PAUSED   # enter: 1     (or set the var in the dashboard)
curl https://sam-gateway.<you>.workers.dev/health          # → {"paused":true}
curl -X POST .../v1/chat -d '{"device":"testdevice","messages":[]}'   # → 503, "gateway paused"
# resume:
npx wrangler secret put PAUSED   # enter: 0
```
SAM clients that were using the gateway automatically fall through to the public no-key lanes while it's paused — they never go dark.

## Conversion instrumentation, without telemetry

To see cost + adoption during the beta you need two numbers, and only two — both derivable from the counters the gateway already keeps, **server-side on your own infra**:
- **device-days** (how many distinct `d:<device>:<day>` keys exist) → active installs over time
- **total calls / spend** (`total:calls`, the daily `g:<day>` counters) → cost

That's the whole conversion picture (adoption + cost) with nothing personal. It lives in *your* Cloudflare account, is never sent back to the app, and the app itself still records nothing.

## Privacy — exactly what it can and can't see

**Stores (KV, short TTL, on your infra):** an anonymous per-install device id, per-device daily counts (`d:<device>:<day>`), global daily counts (`g:<day>`), a cumulative `total:calls`, and any manual `block:<device>` flags. Nothing else.

**Sees transiently (to answer a request, never stored):** the model name and the prompt/messages — which it must forward to the upstream provider to get an answer, exactly like any API call. It is not logged, not written to KV, and not retained.

**Never sees / never stores:** your name, email, IP-derived identity, memory, files, vault, or the *content* of answers. There is no account, no login, no cross-device linking.

Same privacy posture as the rest of SAM: the app records nothing; the gateway records only the anonymous counters that make a fair free allowance possible.

## Hard caps: KV (default) vs atomic (Durable Object)

By default the daily/global/spend caps use Cloudflare KV counters. KV has no atomic increment
(get-then-put is last-write-wins), so a burst of **simultaneous** requests can read the same
pre-increment value and all pass — briefly overspending a cap. The **per-IP daily cap**
(`PER_IP_DAILY`, keyed on the trusted `cf-connecting-ip`) bounds how much any one actor can drain
this way, which is fine for the free plan.

For **exact** caps, bind the `QuotaCounter` **Durable Object** (uncomment the blocks in
`wrangler.toml`). A DO is a single-threaded, consistent actor: every check-and-reserve is
serialised through one instance, so two requests can never both pass when one slot remains, and a
failed upstream call refunds its slot. The Worker uses the DO automatically when bound and falls
back to KV when it isn't — so this is opt-in.

**Trade-off:** Durable Objects require a **Workers Paid** plan (min $5/mo). Bind it only if you want
the caps to be exact rather than best-effort. The per-IP cap already makes the KV path safe for a
modest free-tier deployment. To enable:

```toml
# wrangler.toml — uncomment:
[[durable_objects.bindings]]
name = "QUOTA_DO"
class_name = "QuotaCounter"

[[migrations]]
tag = "v1"
new_classes = ["QuotaCounter"]
```

**Also stored (DO mode):** the same anonymous counters, day-scoped, in the DO's own storage instead
of KV. No new data — same privacy posture.
