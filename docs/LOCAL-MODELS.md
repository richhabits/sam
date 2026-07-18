# Running SAM on a local brain

SAM works out of the box with no keys and no local model — it falls back to free cloud brains
that need no signup. This doc is for the other case: **running the model on your own machine**,
so nothing leaves it.

Every behaviour below is what `server/models.ts` actually does, not an aspiration.

## Setup (two commands)

```bash
brew install ollama && ollama serve      # or the Ollama.app
ollama pull llama3.2:3b                  # SAM's default local model
```

That's it. SAM detects a running Ollama with a model pulled and uses it.

| Setting | Default | What it does |
|---|---|---|
| `OLLAMA_URL` | `http://localhost:11434` | where SAM looks for Ollama |
| `OLLAMA_MODEL` | `llama3.2:3b` | the local chat model |
| `OLLAMA_VISION_MODEL` | `llava` | reads images locally (no Gemini key needed) |
| `HERMES_LOCAL_MODEL` | `hermes3` | local fallback for the Hermes lane |

## The privacy guarantee, stated exactly

**Private/local mode never silently goes to the cloud.** If you ask for local and the local model
isn't responding, SAM tells you so and stops — it does not quietly send your prompt to a cloud
provider to be helpful. The exact message names the fix (`ollama serve`, `ollama pull …`) and
offers Auto/Best as an explicit choice.

That refusal is the feature. A privacy mode that falls back on failure is not a privacy mode.

## When SAM prefers local on its own

With **no cloud keys added** and Ollama up with a model pulled, SAM prefers the local brain —
private, offline, no quota. Add cloud keys and it prefers the (usually faster, stronger) cloud
pool, keeping local as the floor if every cloud lane fails.

## Warm start

At boot SAM sends an empty prompt to Ollama to load the model into RAM (`keep_alive: 30m`), so
your first message doesn't pay the multi-second cold load. It only warms a model that is
**actually pulled**, and it never spends cloud quota to warm up — warming is free or it doesn't
happen.

## "Can I run a 70B on this laptop?"

Short answer: **yes, but you probably don't want to.**

Layer-streaming tools (e.g. [AirLLM](https://github.com/lyogavin/airllm)) run a 70B in ~4GB of
VRAM by streaming layers from disk one at a time. It genuinely works — and it is *slow*, because
every token waits on disk I/O. Fine for an unattended batch job; unusable for a conversation.

For responsive local use, a **quantized mid-size model in Ollama** is the better path. And if
you'll accept the network hop, SAM's free cloud brains are bigger *and* faster than anything
that fits comfortably on a laptop. See `docs/FREE-BRAINS-60S.md`.

The honest ranking for interactive chat: **quantized local model > free cloud brains > 70B via
layer-streaming**, where that last one wins only if the model size itself is non-negotiable and
you don't mind waiting.

## Troubleshooting

- **"Private mode is on … but the local model isn't responding"** — Ollama isn't running, or the
  model isn't pulled. `ollama serve`, then `ollama pull llama3.2:3b`.
- **Local never gets used** — you have cloud keys, so SAM prefers them. Select the local/private
  brain explicitly, or remove the keys.
- **Images aren't read locally** — `ollama pull llava` (or set `OLLAMA_VISION_MODEL`).
