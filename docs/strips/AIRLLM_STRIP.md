# Stripping AirLLM — is there anything great for SAM?

*Source: [lyogavin/airllm](https://github.com/lyogavin/airllm) — Apache-2.0, Python/PyTorch. Runs
oversized LLMs on tiny hardware by **layer-by-layer streaming**: it splits a model to disk and
loads one transformer layer at a time, so a 70B runs on a 4GB GPU and 405B Llama-3.1 on 8GB —
without quantizing the weights. Optional 4/8-bit block compression for "up to 3× speed." CUDA +
Apple MLX. Last release v2.11.0, **August 2024**.*

## Verdict: clever, but not great for SAM — and it's worth being straight about why

The engineering is genuinely neat. But measured against **what SAM actually is** — a free,
responsive, local-first assistant whose local path is already Ollama — AirLLM is the wrong trade
on almost every axis. This is a "took nothing, here's the reasoning" strip, not a dismissal:
the reasoning is the deliverable, because it saves a heavy, low-payoff integration.

### Why it doesn't fit SAM

| Axis | AirLLM | What SAM needs / already has |
|---|---|---|
| **Latency** | layer-streaming loads weights from disk *every forward pass* — throughput is slow by design (the docs pointedly don't quote tokens/sec) | SAM is interactive chat. Seconds-to-minutes per token is unusable for the core UX |
| **The problem it solves** | run a model **too big to fit** even quantized | SAM's common local case (7B–14B) is already handled **faster** by Ollama/llama.cpp (mmap + quantization + Metal/GPU offload) |
| **SAM's actual default** | — | the **cascade routes to ~40 free cloud brains** first — already bigger *and* faster *and* free than a disk-streamed local 70B |
| **Cost of adoption** | PyTorch + HF transformers + per-model disk-splitting (the FAQ warns it's "very disk-consuming") | SAM is a TS/Node app that shells to Ollama; a PyTorch backend is a large new surface for a niche capability |
| **Freshness** | last release Aug 2024; the local-inference field (llama.cpp, MLX, speculative decoding, better GGUF) moved a lot since | SAM's Ollama path rides those improvements for free |

### The one narrow case where it *could* fit (and why it's still marginal)

The only scenario AirLLM wins: **fully offline, no cloud brains reachable, AND wanting a model
bigger than Ollama can fit on the box, AND willing to wait.** That's a real but tiny slice — and
it's *non-interactive by nature*, so the honest framing would be an **opt-in "heavy brain" for
batch/scheduled jobs** (e.g. an overnight scheduled task where latency is irrelevant), never for
chat. Even then it competes with just… using a free cloud brain when online, which is bigger and
instant. So: possible, honest, and still probably not worth the PyTorch dependency for SAM today.

## What SAM actually takes: one idea, zero code

**The technique is worth *knowing*, not vendoring.** "You can run a model larger than your
RAM/VRAM by streaming layers from disk" is a good fact for SAM to be able to *explain* when a
user asks "can I run a 70B locally?" — the honest answer is "yes, via layer-streaming like
AirLLM, but it'll be very slow; for responsive local use, a quantized model in Ollama is the
better path, and SAM's free cloud brains are bigger and faster still." That's a support/FAQ
answer, not a feature. If SAM ever adds a `docs/LOCAL-MODELS.md`, this is one paragraph in it.

## FLIP IT

Nothing. A £5 daily-bar trading rig has no use for giant-model local inference.

## Binned

Everything else — the PyTorch layer-streaming engine, the disk-splitting serializer, the
block-compression, the MLX backend — is a real inference library for a problem SAM doesn't have.
Take the awareness, leave the dependency.

## BOARD paste block

```
- AirLLM stripped (AIRLLM_STRIP.md): layer-streaming to run oversized LLMs (70B@4GB) on tiny
  VRAM, slowly. Verdict: NOT great for SAM — wrong trade on latency (unusable for interactive
  chat), and SAM's common local case is already faster via Ollama while the cascade's free
  cloud brains are bigger+faster+free. Stale (last release Aug 2024). One narrow honest fit:
  opt-in "heavy brain" for offline batch/scheduled jobs — marginal, not worth the PyTorch
  dep now. Takeaway: a one-paragraph FAQ answer ("can I run 70B locally?"), zero code.
  FLIP IT: nothing.
```
