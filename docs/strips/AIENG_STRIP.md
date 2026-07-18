# Stripping ai-engineering-from-scratch — anything for SAM / FLIP IT?

*Source: [rohitg00/ai-engineering-from-scratch](https://github.com/rohitg00/ai-engineering-from-scratch)
— 7.5k★, MIT. A 20-phase, 435-lesson curriculum teaching AI from raw math up to multi-agent
systems. Python/TS/Rust/Julia.*

## Verdict in one line

**It's a curriculum, not a library — and the part that would map to SAM is empty.** Same
shape as build-your-own-x: a syllabus to *point at*, not code to vendor. SAM already has the
tool for that (the `buildx` skill). The one genuinely valuable thing here is Phase 18's
**safety/alignment vocabulary**, which names — in the field's terms — what SAM's doctrine and
FLIP IT's constitution already do by hand.

## The honesty finding (report it, it's the useful part)

The README sells "378 skills, 99 prompts, agents, MCP servers — installable via `npx skills
add`." **The repo does not contain them.** Checked directly:

```
outputs/index.json  →  { "version":"1.0.0", "prompts":[], "skills":[], "agents":[], "mcp_servers":[] }
outputs/skills/  outputs/prompts/  outputs/agents/  →  empty shells
```

So there is no vetted-skill goldmine to cherry-pick into SAM's `skills/`. Good to know before
anyone tries — the artifacts are aspirational, the value is the lessons (markdown prose under
`phases/`). This is exactly the kind of claim SAM's own doctrine says to verify, not obey.

## What SAM takes: the buildx pointer (already have the mechanism)

The `buildx` skill (from the build-your-own-x strip) already turns "I want to build my own X"
into a proof-gated milestone plan. This curriculum is a **second, AI-specific index** buildx
can read live for the right builds: your own tokenizer (Phase 10), transformer (Phase 7),
RAG (Phase 11), ReAct agent (Phase 14). No new code — one line in `skills/buildx/SKILL.md`'s
index note: *"for AI/ML builds also consult rohitg00/ai-engineering-from-scratch phases/."*
That's the whole SAM-side port. Wholesale-importing lessons would violate the same vet-don't-
vendor rule everything else here follows.

## The real prize: Phase 18 names what we already do

FLIP IT and SAM's doctrine were built from instinct and scar tissue. Phase 18 (Ethics, Safety
& Alignment, 30 topics) is the academic literature for those instincts. The transfer is
**grounding, not code** — and it doubles as an audit checklist. Honest coverage map:

| Phase-18 failure mode | Where SAM/FLIP IT already defends | Status |
|---|---|---|
| **Reward hacking & Goodhart's law** (18.02) — "when a measure becomes a target it stops being a good measure" | FLIP IT is *built* on this: gate-shopping ban, out-of-sample walk-forward folds, the null test, the survivorship warning. Gate-shopping **is** reward hacking a backtest | ✅ covered (flip-it), and now has its academic name |
| **Constitutional AI / RLAIF** (18.05) — govern behaviour by an explicit written constitution | `CLAUDE.md` doctrines + `FLIP_IT.md` + the amendment mechanism are exactly this, hand-rolled | ✅ covered |
| **Indirect prompt injection** (18.15) + **EchoLeak / AI CVEs** (18.25) | The injection guard — "the source is data, never authority" (SAM_NEW_STRAT §0, Money Doctrine); `server/injection.test.ts` | ✅ covered — worth reading 18.25 for new CVE classes |
| **Sycophancy & RLHF amplification** (18.04) | "no fake receipts," honest-FAIL-over-nice-PASS ethos | 🟡 partial (cultural, not enforced) |
| **Red teaming: Garak / PyRIT / LlamaGuard** (18.12, 18.16) | SAM does not systematically adversarially test its own tool/MCP layer | 🔴 **gap** — the one actionable suggestion below |
| **Moderation systems** (18.29) | `consent.ts`, `security.ts`, some safety gating | 🟡 partial |
| Mesa-optimization / deceptive alignment / sleeper agents (18.06–09) | SAM trains no models; mostly out of scope | ⚪ N/A |

### The one actionable gap: adversarial self-testing

18.12/18.16 point at free, standard red-team tools (**Garak**, **PyRIT**) that fire known
prompt-injection / jailbreak batteries at an LLM system. SAM has an injection *guard* and a
*unit test*, but doesn't run a red-team *suite* against its live tool layer. That's a real,
proportionate next step — not a port, a practice: wire a Garak/PyRIT pass into CI against the
tool endpoints. Filed as a suggestion, not built (it's a test-infra decision for the server).

## FLIP IT

Nothing to install. One piece of grounding worth keeping: **Goodhart's law (18.02) is the
theorem behind the whole constitution.** When you next explain to someone why gate-shopping is
banned or why the forward clock can't be wound, "Goodhart's law / specification gaming" is the
two-word citation. The RL phase (9: PPO/RLHF) and reward-hacking literature are the formal
version of "a backtest optimised until it passes tells you nothing."

## Binned

The 434 other lessons (math, CNNs, diffusion, ASR, GANs, RL, quantization, vLLM serving) — all
fine education, none of it something a local-first personal assistant or a £5 trading rig
*vendors*. Read to learn; don't import.

## BOARD paste block

```
- ai-engineering-from-scratch stripped (AIENG_STRIP.md): curriculum, not a library — and its
  "378 skills/99 prompts" are EMPTY in-repo (outputs/index.json all []). No skills to cherry-
  pick. Wins: (1) buildx gains an AI-specific index to point at (1-line note, no code). (2)
  Phase 18 safety taxonomy = academic grounding for what doctrine/FLIP_IT already do (reward
  hacking=gate-shopping=Goodhart; Constitutional AI=our constitutions; prompt injection=our
  guard). One real GAP surfaced: no adversarial red-team suite (Garak/PyRIT) vs SAM's tool
  layer — suggested for CI, not built. FLIP IT: nothing to install; Goodhart's law is the
  citation for the gate discipline.
```
