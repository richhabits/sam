# Stripping JAX — NEXT (nothing to take, and a good reason why)

*Source: [jax-ml/jax](https://github.com/jax-ml/jax) — Google's Python library for
accelerator-oriented array computing: `grad` (autodiff), `jit` (XLA compile to GPU/TPU),
`vmap`/`pmap` (vectorise/parallelise), NumPy-compatible. Built for large-scale ML training and
scientific computing on accelerators.*

## Verdict: NEXT — for both, decisively

Not a close call. This is world-class software aimed at a problem neither SAM nor FLIP IT has.

**SAM** — a TS/Node local-first assistant that shells to Ollama and calls LLM APIs. It trains
no models, computes no gradients, needs no XLA. JAX has no seam to enter through. Nothing.

**FLIP IT** — Python, so *superficially* a candidate. Two reasons it's a hard no, one of them
principled:

1. **JAX's headline feature is the thing the constitution BANS.** `grad` + gradient descent
   exist to *optimise parameters against an objective*. FLIP IT's entire discipline —
   gate-shopping ban, the null test, no-tuning-to-pass — exists to stop exactly that:
   optimising a strategy until the backtest looks good. Bolting an autodiff optimiser onto the
   rig isn't a feature, it's a loaded gun pointed at the one rule that protects the fiver.
   (This is the sharp bit: JAX is anti-aligned with the constitution by design, not by scale.)

2. **The scale is wrong by ~6 orders of magnitude.** FLIP IT runs ~12 tickers × daily bars ×
   ~10 years ≈ a few thousand rows. pandas/numpy backtests that in milliseconds. JAX (+ XLA,
   hundreds of MB, ideally a GPU) is built to shard across *thousands of devices*. Strapping a
   supercomputer compiler to a spreadsheet-sized problem buys nothing but dependency weight.

## The one idea, filed not taken

`vmap` (auto-vectorise a function across an axis) is elegant, and "run one backtest function
across many inputs at once" sounds tempting — but at FLIP IT's scale numpy broadcasting already
does it, and "many inputs" usually means *many parameter sets*, which is gate-shopping wearing a
performance hat. So even the borrowable idea routes back into the banned zone.

## FLIP IT / SAM takeaway

Nothing to build, nothing to connect, nothing to bump. Clean next.

## BOARD paste block

```
- JAX stripped (JAX_STRIP.md): NEXT — nothing for SAM (no model training / XLA need in a
  TS assistant) or FLIP IT. Sharp reason for flip-it: JAX's core = gradient-based optimisation,
  which is exactly the curve-fitting/gate-shopping the constitution bans (anti-aligned by
  design, not scale); and its scale (thousands of devices) is ~6 orders over a few-thousand-row
  daily-bar rig numpy handles in ms. Zero code.
```
