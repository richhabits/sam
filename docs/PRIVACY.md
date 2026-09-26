# SAM Privacy

Short version: **SAM stores everything on your machine and phones home to nobody.** No account, no
tracking, no analytics. (The phone app's Standalone mode is the one place a message leaves the device
for a third-party AI service — with your permission first, and spelled out below.) The one thing that does leave — a request you send to a cloud model you
configured — is spelled out plainly below rather than buried. This document is exact.

## What SAM stores, and where

All of it, locally, always:

- **Your content** — prompts, messages, files, the life index, memory, vault — is stored only on this
  device. SAM never uploads it, backs it up, syncs it, or sends it anywhere of its own accord.
- **What SAM learns about you** — preferences, patterns — is stored locally, inspectable and deletable in
  "What SAM has learned about you". It is never sent to any AI provider or gateway, and never used as
  training data. (Enforced by a test that locks the module off the wire.)
- **Your usage stats** — the "Your SAM" dashboard (tasks run, tools used, retention days, hours saved) is
  computed and stored **locally**. It's a feature for you, not surveillance of you.

## What leaves, when you ask a cloud model

Be clear-eyed about this one, because it is the only routine exception and a vague promise here would be
worse than none.

Choose a cloud brain, and your request goes to that provider under their terms — the same as using their
API directly. **That request is not only what you typed.** To answer you, SAM may first read a file, a
web page, an email or your clipboard, and the result becomes part of the conversation sent to the model.
So a file you asked SAM about does leave the device, to that provider, for that request.

What never rides along, even then: your stored memory and vault, the life index, learned preferences, and
usage stats. Only the conversation in play is sent.

**Offline mode sends nothing at all.** Point SAM at a local Ollama model and there is no exception left —
no request, no content, nothing on the wire. That is the mode to use for anything you would not hand to a
third party, and it is the mode this claim is measured against.


## The iPhone and iPad app

The phone app works in one of two modes, and what leaves the phone depends on which.

**Paired with your own computer.** Your messages go to SAM running on *your* Mac or PC, over your own
network. That machine is yours, not ours. What it does next follows the section above: if you have
turned on a cloud model there, the request goes to that provider from your computer.

**Standalone (no computer paired, or your computer is unreachable).** The phone sends your message
straight to third-party AI services to write the answer, and **the app asks your permission first**,
naming them, before the first message is sent. What is sent: the text you type, the recent conversation
for context, and text taken from anything you attach. What is not sent: your contacts, photos you have
not attached, location, or anything else on the phone.

- **Out of the box** the recipients are the free, keyless services Pollinations and OpenRouter.
- **If you add your own API keys** (Settings → Cloud AI Engine) it can also be Groq, Cerebras, Mistral,
  Google Gemini, Anthropic, DeepSeek, Together AI, SambaNova, Novita, SiliconFlow, Zhipu, Alibaba (Qwen),
  Fireworks, Nebius and the other providers listed in that screen. Some of these operate outside the UK
  and EU.
- **Each provider handles your message under its own terms and privacy policy.** We do not control how
  long they keep it or whether they use it, and we can't promise the same protection they offer.
  Read theirs before you turn one on.
- **We receive none of it.** SAM has no servers for your messages. There is no account, no analytics
  and no advertising identifier in the phone app.

You can withdraw permission at any time in Settings → Privacy → Stop sharing with cloud AI; the app then
asks again before the next message. The **demo** ("Explore the demo") makes no network requests and sends
nothing anywhere.

**On the phone itself:** your API keys and your recent conversation are kept in the iOS Keychain. Deleting
the app, or Settings → Disconnect / Forget this device, removes them. Anything a third-party provider has
already received has to be deleted with that provider — we have no copy to delete.

## The one optional thing: anonymous telemetry (OFF by default)

To know whether people actually use and keep SAM, there's an **opt-in** anonymous ping. It is:

- **Off by default.** You're asked once, with a neutral choice — "no" is a real answer, and SAM won't nag.
- **Anonymous.** A random per-install id, minted only if you opt in and discarded if you opt out. No
  account, no name, no email, no IP-based identity.
- **Aggregate + whitelisted.** Only a fixed, closed set of fields can ever be sent. You can see the exact
  payload before deciding (Settings → the preview).

### Exactly what IS sent (only if you opt in)

| Field | Example | Why |
|---|---|---|
| `schema` | `sam-telemetry/1` | version of the format |
| `anonId` | random 32-hex | count distinct installs (nothing else) |
| `version` | `3.1.1` | which release is in use |
| `os` | `darwin` | platform mix |
| `dau` | `true` | were you active today (retention curve) |
| `retentionBucket` | `d7` | how long you've kept SAM (d1/d7/d30/d30+) |
| `activated` | `true` | did you complete a first successful task |
| `crashFree` | `true` | stability |
| `features` | `{tasks: 12, toolUses: 34, workflowRuns: 2, cacheHits: 4}` | which capabilities get used — **counts only** |

### Exactly what is NEVER sent — even if you opt in

Prompts · messages · file names or paths · tool inputs · workflow contents · learned preferences · your
name/email · location · IP-derived identity · **any free text you or the model produced.** The telemetry
payload is built from a whitelist of aggregate numbers; content cannot appear in it. There is a test
(`telemetry.test.ts`) that feeds a *poisoned* stats object full of fake secrets and asserts none of it
reaches the wire, and a `isSendable()` tripwire that refuses any payload with a non-whitelisted key.

## Where telemetry goes

If enabled, the anonymous payload posts to SAM's own aggregate endpoint (the same anonymous-device-id
gateway pattern used for the optional free brain — no third-party analytics SDK, no ad networks).

## Your controls

- **Opt in / out any time** — Settings → Telemetry (defaults to off).
- **Preview the exact payload** before deciding.
- **Reset your local stats** any time.
- **Reset what SAM has learned** any time.

If a feature can't be built without transmitting your content, SAM doesn't build it. That's the rule.
