# Stripping kimi-cli — and the live bug it flushed out

*Source: [MoonshotAI/kimi-cli](https://github.com/MoonshotAI/kimi-cli) — Python agentic coding
CLI (like Claude Code / Gemini CLI): reads/edits code, runs shell, MCP + ACP (Agent Client
Protocol) for IDE integration, shell mode via Ctrl-X. Uses Moonshot's Kimi models.*

## Verdict: don't take the CLI — take the model bump it exposed

Two facts kill the CLI-as-component idea immediately, and then the strip pays off somewhere
unexpected:

1. **It's being wound down.** The README says it's "transitioning to successor project
   [kimi-code]" with installs auto-migrating. Building on a repo whose own authors are
   sunsetting it is a non-starter.
2. **SAM *is* this.** SAM is already an agentic CLI/agent platform with its own loop, MCP,
   tools, and skills. kimi-cli is a *competitor*, not a part to bolt on.

But following the thread to **Kimi-the-model** flushed out a real, live bug in SAM. That's the
payoff.

## The find: SAM's Kimi brain is on a DEAD model (fixed)

SAM already carries Moonshot as a free-tier brain (`server/models.ts`):

```
{ id: "moonshot", tier: "free", ... callOpenAICompat("https://api.moonshot.cn/v1", MOONSHOT_MODEL ...) }
const MOONSHOT_MODEL = process.env.MOONSHOT_MODEL || "moonshot-v1-8k";   // ← the problem
```

`moonshot-v1-8k` is not just old — per Moonshot's platform docs it is **being sunset on
2026-08-31 and is already "no longer available to newly registered users."** So for any *new*
SAM install, the Moonshot brain was pointing at a model it can't even call — a silently dead
brain in the cascade (SAM routes around it, so it fails quietly, which is why nobody noticed).

**Fixed** — bumped the default to the current coding model:

```
const MOONSHOT_MODEL = process.env.MOONSHOT_MODEL || "kimi-k2.7-code";   // K2.7 coding, 256k ctx
```

`kimi-k2.7-code` is the current coding-specialised Kimi (256k context, strong on
coding/agentic benchmarks). Alternatives noted inline: `kimi-k2.7-code-highspeed` (faster, for
the speed-first lane) and `kimi-k3` (1M-context flagship). This turns a dead brain back into a
strong one, at zero cost — SAM's `tier: free` here means Moonshot's new-key trial credit, same
posture as the zhipu/hermes entries beside it.

**Honesty caveat:** I could not live-test the Moonshot endpoint from here (needs a key, and
`api.moonshot.cn` may be geo-restricted). The model id is verified against Moonshot's published
model list; the terminal session should confirm the brain answers with a real key. Worst case if
the id is off: the brain errors and the cascade skips it — exactly today's status quo, so the
change can't regress anything.

## Secondary note (not changed): the endpoint

The brain uses `https://api.moonshot.cn/v1` — the **China** endpoint. For a UK/US user the
**international** `https://api.moonshot.ai/v1` may be faster/reachable. I left it alone (one
change at a time, and it's a separate reachability question), but it's worth a look when someone
next has a Moonshot key in hand.

## One idea worth filing: ACP (Agent Client Protocol)

kimi-cli (and Zed) speak **ACP** — a protocol that lets any IDE drive any agent as a server
(`kimi acp`). If SAM ever wants first-class IDE integration (Zed/JetBrains/VS Code talking to
SAM as the agent), implementing an ACP server is the standard door. Bigger than this strip, and
SAM already has its own surface, so: **filed, not built.**

## FLIP IT

Nothing. A coding CLI and an LLM have no place in a mechanical £5 daily-bar rig (and the
constitution keeps LLM opinions out of trading decisions on purpose).

## BOARD paste block

```
- kimi-cli stripped (KIMI_STRIP.md): CLI itself binned (being sunset → kimi-code; and SAM IS an
  agent CLI). Real payoff = it exposed a LIVE bug: SAM's Moonshot brain was pinned to
  `moonshot-v1-8k`, which sunsets 2026-08-31 & is already unavailable to new signups = a dead
  brain for new installs. FIXED in models.ts → `kimi-k2.7-code` (256k coding model), mtime-
  guarded; couldn't live-test the endpoint (needs key/geo) — cascade skips it if wrong, so no
  regression risk. Secondary note: endpoint is api.moonshot.cn (China); api.moonshot.ai may be
  better for UK/US — left for a key-in-hand check. Filed idea: ACP server for IDE integration.
  FLIP IT: nothing.
```
