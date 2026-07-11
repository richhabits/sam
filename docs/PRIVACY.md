# SAM Privacy

Short version: **SAM runs on your machine. By default, nothing about you leaves it — ever.** No account,
no tracking, no phone-home. This document is exact about what that means, and about the one thing that is
optional and off by default.

## What stays on your device, always

Everything by default:

- **Your content** — prompts, messages, files, the life index, memory, vault — never leaves the device.
  In offline mode (a local Ollama model), nothing leaves at all.
- **What SAM learns about you** — preferences, patterns — is stored locally, inspectable and deletable in
  "What SAM has learned about you". It is never sent to any AI provider or gateway, and never used as
  training data. (Enforced by a test that locks the module off the wire.)
- **Your usage stats** — the "Your SAM" dashboard (tasks run, tools used, retention days, hours saved) is
  computed and stored **locally**. It's a feature for you, not surveillance of you.

When you send a request to a cloud model *you* configured, only that request goes to that provider under
their terms — the same as using their API directly. Local/offline mode sends nothing.

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
| `version` | `2.0.0` | which release is in use |
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
