# SAM Packs gallery

Packs are shareable bundles — skills, prompts, watched-folder templates, and (safety-gated) tools. **Importing one never auto-installs anything:** SAM shows you what's inside, runs a static scan + sandbox test on any tool, and installs only what you approve (tools land disabled to review). [How the safety model works →](../SECURITY.md#self-written-tools-the-forge)

Browse the community index in-app (**Settings → Packs → Browse community**) or at [richhabits/sam-packs](https://github.com/richhabits/sam-packs). Export your own setup in one tap and PR it.

## Starter packs (shipped)

| Pack | What it does |
|---|---|
| 🏠 **Landlord Dispute Assistant** | Fight an unfair deposit deduction or disrepair issue — evidence-first, by the book. |
| 📋 **Planning Application Helper** | Navigate a UK planning application or neighbour objection without a consultant. |
| ✍️ **Content Studio** | Turn one idea into a week of on-brand content across channels. |
| 💻 **Dev Sidekick** | A pragmatic pair-programmer — reads the repo, explains, fixes. |
| 🔎 **Research Analyst** | Multi-source, fact-checked briefings with citations. |
| 🗂️ **Home Ops** | Household admin — bills, renewals, reminders, the boring stuff. |

Each is a safe playbook (skills + prompts, no code) and doubles as a demo of what SAM can do for a real use-case.

## Make your own
1. In SAM: **Settings → Packs → Export** — choose skills/prompts/tools; it's signed with your local key.
2. Test it: `node community/sam-packs/validate.mjs packs` (format + the same static safety scan SAM uses).
3. PR it to `richhabits/sam-packs` — CI validates every pack on the way in.

**Safety recap:** signing proves a pack wasn't tampered, not that it's trustworthy — the forge pipeline + your explicit approval always apply. Forged tools declare capabilities; `net`/`fs:write` are dangerous-tier; shell can never be forged.
