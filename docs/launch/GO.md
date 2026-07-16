# 🚀 GO — the launch-day script

The one un-automatable act. Everything else is built; this is you, a keyboard, and a few hours. Follow it
top to bottom. All the copy already exists in this folder — this is the *order* and the *live responses*.

## Pre-flight (the night before)
- [ ] `docs/media/demo.gif` is current and shows the **memory hook** — you tell SAM about your brand, it
      writes an on-brand bio from what it remembered ("it remembers you", your strongest pitch). (It is.)
- [ ] Latest release is live + Gatekeeper-accepted: **v2.1.2 ✓** (signed + notarized, verified on the
      downloaded dmg — not just a green CI job).
- [ ] Skim the hostile-Q answers below until you can paste them from memory.
- [ ] Clear your calendar for launch morning + the next 6 hours. You're replying, not building.

## The order (do NOT do these simultaneously)

**T+0 — Tuesday, ~8:00 AM US Eastern → Show HN.** Highest-signal, most-skeptical, sets the tone.
- Title: `Show HN: SAM – a private, local-first AI assistant that does the work (MIT)` (from `show-hn.md`).
- Post the URL, then **immediately** paste the first comment from `show-hn.md` (leads with the honest
  node:vm-RCE-found-and-fixed story — HN gold).
- **Then stay in the thread for 3–4 hours.** Answers > everything. Ranking rewards early engaged replies.

**T+2h — Reddit r/LocalLLaMA** (`reddit.md`). Best-fit community. Disclose you're the maker, link in a
comment, lead with the local/Ollama routing + the sandbox story.

**T+4h — Product Hunt** (`product-hunt.md`). Schedule for 12:01 AM PT ideally; else post now.

**T+6h — X/Twitter thread** (`x-thread.md`). Attach `demo.gif` to tweet 1. Tweets 8–9 (the RCE find) are
the quote-tweetable pair.

**T+24–48h — the awesome-list PRs** (`awesome-submissions.md`), once HN traffic proves the repo's alive.
File the easy ones first; hold awesome-selfhosted.

## Positioning — the one sentence (use everywhere)
> The only AI assistant that's genuinely private, works offline and free out of the box, and gets *more
> useful the more you use it* — because it learns you on your device, not in someone's cloud.

## The predictable hostile questions — pre-written answers

**"How is it free? What's the catch?"**
> No catch on the core — it's MIT and runs on your machine, so it costs *me* nothing when you use your own
> Ollama or free-tier keys. There's an optional hosted "SAM Cloud" for people who don't want to set up keys
> (that costs me inference, so it's paid) — but it's off, and it never gates anything the free version does.

**"Privacy — prove it."**
> Pull your wifi; it still works (local Ollama). Keys, memory, files, and what it learns about you never
> leave the device — there's a test that locks the learned-state module off the wire, and telemetry is
> off-by-default, anonymous, whitelist-only (content *cannot* be in a payload). It's all in `docs/PRIVACY.md`.

**"How is this different from Ollama + Open WebUI / Jan?"**
> Those give you a private local *chat*. SAM is a private local *doer* — 170+ tools, it acts on files/email/
> shell/GitHub, has an ⌥Space overlay anywhere, an on-device index that cites your files, and it learns your
> preferences locally. Closest on privacy; the difference is it does things, not just talks.

**"vs Cursor / ChatGPT desktop?"**
> Cursor is better *in the editor*; ChatGPT is a better raw model. SAM wins when you want an AI that acts
> across your *whole computer* and refuses to send your life to a cloud. Different job. (`docs/COMPETITIVE.md`
> is honest about where SAM loses, too.)

**"Is the self-writing-tools thing (the forge) safe?"**
> Fair to worry. Forged code runs in a separate process with codegen disabled — not `node:vm`, which isn't a
> security boundary. I found and fixed an RCE in the old vm sandbox *before* launch; it's in the security
> audit doc, with regression tests. Dangerous tools always ask first, no bypass.

**"Solo dev / will this be maintained?"**
> Solo today, yes. But the repo maintains itself — automated releases, a daily health watchdog, dependency
> autopilot, and self-service diagnostics — so my time goes to users, not babysitting. And it's MIT, so it
> can't be taken away.

## Rules for replying
- **Fast, honest, non-defensive.** Concede real weaknesses (model quality on hardest tasks, it's young).
  Skeptics trust someone who admits limits.
- **Never argue.** Answer the question, link the proof, move on.
- **Turn bugs into goodwill:** "great catch, fixed on main" beats defending.

See `72H-TRIAGE.md` for what to watch after the posts go up.
