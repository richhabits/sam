# Strip-map: 500-AI-Agents-Projects → SAM (+ the Junie note)

*Source: [ashishpatel26/500-AI-Agents-Projects](https://github.com/ashishpatel26/500-AI-Agents-Projects) —
a catalog of ~130+ agent use-cases with code links, organized by framework (CrewAI ~21,
AutoGen ~50+, Agno ~18, LangGraph ~20+, plus a general table).*

## The strip verdict

**Bin the frameworks, port the workflows.** Every entry is a use-case implemented in
CrewAI/AutoGen/LangGraph — machinery SAM already has natively (agent crew, tools,
memory, skills). SAM's drop-in system means each worthwhile use-case is a **SKILL.md,
not a dependency**. 500 projects → ~12 skill candidates → 0 new frameworks.

## Skill candidates, mapped to SAM's existing packs

| Catalog idea | SAM home | Port as |
|---|---|---|
| Email auto-responder | `skills/comms` (extend) | drafts-with-approval loop over Mail — SAM has send-email ask-first already |
| Lead score flow | `skills/sales` (extend) | score inbound leads from email/CSV → ranked list + next action |
| SQL agent | new `skills/data` | natural language → query → sanity-check → answer, ask-first on writes |
| Legal document analysis | `skills/legal` (extend) | PDF in → clause flags + plain-English summary (SAM reads PDFs already) |
| Recruitment workflow | `skills/hr` (extend) | CV stack → shortlist matrix → interview questions |
| Trip planner | new `skills/travel` | constraints → itinerary → calendar events (ask-first) |
| Customer support agent | `skills/comms`/gateway | FAQ + ticket triage over SAM's channel adapters |
| Adaptive RAG | core, not a skill | note for `server/`: retrieval that widens only on low confidence — cheap win for the cascade brain |
| Health insights | `skills/health` (extend) | report in → structured insights, with the existing not-a-doctor guardrails |
| Virtual tutor | `skills/learn` (extend) | topic → spaced lesson plan → daily reminder loop |
| Finance agent | **do NOT port** | trading lives in FLIP IT under the constitution — no second, gate-free money path. The catalog's "automated trading bot" is exactly what the gates exist to prevent |
| Multi-agent collab patterns | already SAM | read for prompt patterns only |

Priority if Romeo wants one this week: **email auto-responder** (highest daily value,
lowest new surface — extends an existing ask-first tool).

## The Junie note (also asked)

[JetBrains Junie](https://www.jetbrains.com/junie/) ([docs](https://www.jetbrains.com/help/ai-assistant/junie-agent.html),
[out of beta 06/2026](https://blog.jetbrains.com/junie/2026/06/junie-coding-agent-out-of-beta/), IDE + CLI):
delegate coding task → agent explores/edits/runs tests → verified result, steered by
[guidelines + memory files](https://junie.jetbrains.com/docs/guidelines-and-memory.html).
**SAM already covers the pattern for its domain**: skills = playbooks, memory = built-in,
doctrine #1 = test-verified done. The one idea worth nicking: Junie's *per-project
guidelines file convention* → SAM could auto-load a `SAM.md` from any folder it's working
in (project-scoped context, like CLAUDE.md but per-folder). Small, real, queue it.

## BOARD paste block

```
- 500-AI-Agents strip-map done (SAM_AGENT_IDEAS.md): frameworks binned, 12 SKILL.md
  candidates mapped to packs; first pick = email auto-responder. Finance agent
  explicitly NOT ported (FLIP IT constitution owns money).
- Junie checked: pattern already covered; queue "per-folder SAM.md auto-load" as a
  small feature idea.
```
