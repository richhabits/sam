# SAM Skills — the drop-in system

A **skill** is a folder here with one file: `SKILL.md`. SAM loads every skill's
metadata at boot, and when a message matches a skill's triggers it injects that
skill's full playbook into the model. No code change, no restart config — drop a
folder, and SAM has a new capability.

This is how SAM scales: find a good skill anywhere (a GitHub repo, a prompt, a
playbook) → rewrite it as a `SKILL.md` → drop it in → done.

## The format

```markdown
---
name: My Skill
tier: free            # local | free | premium  (which model tier it prefers)
triggers: keyword one, keyword two, phrase that routes here, another
---

# My Skill

Who SAM is when this skill is active, and what it does. Written as instructions
to SAM in the second person ("You ...").

## Rules
- Hard constraints. What to always/never do. Confirm-before-acting for anything
  irreversible (payments, sending, deleting).

## Output
- The exact shape of the answer SAM should return.
```

**Front-matter fields**
- `name` — display name in the HUD.
- `tier` — `local` (free, on-machine), `free` (Gemini/Groq/OpenRouter), or
  `premium` (Claude/OpenAI). Routing still falls back down the chain if a tier
  has no key.
- `triggers` — comma-separated keywords/phrases. Routing is a cheap
  case-insensitive substring match (the "regex layer") — most messages never
  need a model just to pick a skill. Highest trigger-overlap wins.

## Add one

```bash
npm run skill:new "Legal"        # scaffolds skills/legal/SKILL.md
# edit the file, fill in triggers + playbook
npm run dev                      # SAM picks it up on boot
```

Or by hand: `mkdir skills/legal && $EDITOR skills/legal/SKILL.md`.

## Porting a skill from GitHub / elsewhere
1. Read what the original does.
2. Strip its branding — in SAM it's **SAM**, speaking to the user.
3. Map its behaviour into `# playbook` + `## Rules` + `## Output`.
4. Pick `tier` by cost/quality need; add sharp `triggers`.
5. Drop the folder in, `npm test`, `npm run dev`, try it.

## Shipped skills
`brand · breeding · browse · build · comms · content · finance · ops · research`
