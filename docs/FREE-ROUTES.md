# The free lane — what's actually alive

SAM's promise is that it works, well, for free. That promise depends on a cascade of ~30 free
brains, and a cascade **fails silently by design**: when one brain doesn't answer, the next is
tried, and you get your reply. Nothing tells you the first three were dead.

They rot, too. Providers retire model slugs, close free tiers, and shut whole products down. A
hardcoded slug that worked at release is a 404 six months later, and if that brain leads its lane,
**every single turn now opens with a failure.**

## The audit that made this page (2026-08-01)

Eleven free brains were called by hand, once each. Seven were dead:

| brain | what it actually did | why |
|---|---|---|
| groq | ✅ 115 ms | healthy |
| mistral | ✅ 297 ms | healthy |
| gemini | ✅ 430 ms | healthy |
| nvidia | ⚠️ 11 s, then two 30 s timeouts | alive but far too slow to lead |
| **cerebras** | ❌ HTTP 404 `model_not_found` | `llama-3.3-70b` was **retired**. Live list: `zai-glm-4.7`, `gpt-oss-120b`, `gemma-4-31b` |
| **openrouter** | ❌ HTTP 404 | the `:free` variant of that slug was withdrawn; OpenRouter's own error names the paid replacement |
| **github models** | ❌ HTTP 410 `github_models_retirement_brownout` | the product is being **retired** |
| **hermes** | ❌ HTTP 402 + an x402 payment challenge | Nous **charges** for it now |
| **pollinations** ×3 | ❌ HTTP 402, taking up to **24 seconds** to say no | the anonymous tier is **cache-only**: repeated identical prompts return 200 from its cache, anything novel is Payment Required |

Two of the dead ones led their lanes: `cerebras` was first in `fast`, `hermes` was first in both
`deep` and `code`. So a quick chat began with a 404 and a considered answer began with a 402.

And the no-key floor — the thing that makes SAM work before you've added anything — was gone. A
user with no keys and no Ollama had **no working free brain at all**.

## What changed

**The slugs were fixed.** `CEREBRAS_MODEL` → `gpt-oss-120b` (422 ms), `OPENROUTER_MODEL` →
`nvidia/nemotron-3-super-120b-a12b:free` (579 ms, 262k context). Both were chosen by asking each
provider's own `/v1/models` what exists and timing the candidates.

**The lanes were re-ordered** around what the audit measured, and `hermes` no longer leads
anything.

**SAM measures now, so this can't rot the same way.** Every brain call is timed in the Relay — the
one place they all pass through — and the outcome is remembered in `vault/brain-health.json`
(`server/speed.ts`). The free ordering follows the measurement:

- a **terminal** failure (401, 402, 403, 404, 410) means *gone*, not *busy*: that brain sinks to
  the bottom for six hours. A retired slug looks exactly like this.
- a brain that has been called repeatedly and **never once answered** sinks too — that's what a
  timeout looks like, and no status code would ever have caught it.
- a brain measurably slower than the leader is demoted, within a tolerance so a 100 ms leader
  doesn't demote a perfectly good 400 ms one.
- **nothing is ever removed.** A demoted brain is still tried when the ones above it fail, and one
  good answer heals it instantly — no file to clear, no restart. A re-issued key just works.

**The cascade is hedged.** Free calls carry a 30-second timeout, and the cascade was strictly
serial — so one stalled brain owned the entire turn before the second was even attempted. Now, if
the leader hasn't answered within the hedge window (1.4 s for `fast`, 4 s for `deep`/`code`), the
next brain starts *alongside* it and whoever answers first wins. At most three run at once.

Never on premium: firing two paid calls to save a second is spending your money on impatience.

## Check it yourself

```
npm run routes              # what SAM has learned from real use — calls nothing, costs nothing
npm run routes -- --probe   # one short call to every free brain, then the table
```

`--probe` spends roughly 15 output tokens per brain, on purpose. That is the price of knowing.

Sunk brains print the status that sank them. If you see one, look up the provider's live model
list and set the slug in `.env` — e.g. `CEREBRAS_MODEL=gpt-oss-120b`. **A slug pinned in your
`.env` overrides the fixed default**, which is its own trap: this machine's `.env` still pinned the
retired OpenRouter slug, so the code fix alone changed nothing until the `.env` line was updated too.

## Kill switches

| variable | effect |
|---|---|
| `SAM_HEDGE=0` | strictly serial cascade, the old behaviour |
| `SAM_HEDGE_INFLIGHT=n` | how many free calls may race (default 3) |
| `SAM_SINK_MS=n` | how long a terminally-failed brain stays sunk (default 6 h) |
