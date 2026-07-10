# Awesome-list submissions — ready-to-file PR drafts

**One PR per list.** Each is drafted below: the exact entry, PR title, PR body, and the one rule most
likely to trip you. File these **after** the demo GIF is live and the v1.6.0 release is published —
maintainers click straight through to the repo, so the front page must be whole first.

> **Counts are truth-checked** against `docs/stats.json` (CI enforces no drift): **173 tools · 78 agents
> · 25 skills · 40 free brains.** Update these numbers if `npm run stats` changes them before you file.
>
> **Licensing: clear.** SAM is **MIT** — all five lists (incl. OSS-only awesome-selfhosted / awesome-electron)
> accept it. Every list forbids marketing adjectives in the description; the entries below are already neutral.

Before each PR: **read that list's CONTRIBUTING**, place the entry **alphabetically** in the right section,
one clean commit, link the **repo** (not the landing page).

---

## 1. awesome-ai-agents — `e2b-dev/awesome-ai-agents`  ✅ strong fit

**Entry** (place alphabetically in the open-source agents section):
```md
- [SAM](https://github.com/richhabits/sam) - Local-first personal AI assistant with a team-of-agents mode and 173 tools; routes to your local Ollama model or rotating free cloud tiers, and asks before any dangerous action.
```
**PR title:** `Add SAM`
**PR body:**
> Adds SAM — a local-first, MIT-licensed personal AI assistant. It runs a team of specialist agents,
> ships 173 tools (web, files, shell, email, GitHub…), routes each task to the cheapest brain that fits
> (local Ollama → free cloud tiers), and gates every dangerous action behind an explicit ask-first prompt.
> Repo: https://github.com/richhabits/sam · MIT · actively maintained.

**Watch:** alphabetical order within the section; one-line description only.

---

## 2. awesome-local-ai — `janhq/awesome-local-ai`  ✅ strong fit

This list uses **tables** per category. SAM fits the **assistants / desktop** category. Match the existing
column layout — commonly `| Name | Description | Links |`:
```md
| [SAM](https://github.com/richhabits/sam) | Personal AI assistant that defaults to your local Ollama model when no cloud key is set — private and fully offline — with 173 tools and a team-of-agents mode. | [GitHub](https://github.com/richhabits/sam) |
```
**PR title:** `Add SAM`
**PR body:**
> SAM runs entirely on your machine and defaults to your local Ollama model when you have no cloud keys —
> private and offline-capable. 173 tools, a team-of-agents mode, MIT-licensed. https://github.com/richhabits/sam

**Watch:** copy the **exact column structure** of the section you add to (tables differ per section); lead
with the *local/offline* capability — that's what this list is about.

---

## 3. awesome-privacy — `pluja/awesome-privacy`  ✅ good fit

⚠️ This list migrated to a **structured data format** (entries under `_data/…`, not a plain README list).
Check the current CONTRIBUTING — you may add a YAML/structured entry rather than a markdown line. The
content to submit:
- **Name:** SAM
- **URL:** https://github.com/richhabits/sam
- **Description:** Personal AI assistant that runs on your own machine; keys, memory and data stay local, nothing leaves in offline mode, zero telemetry. MIT.
- **Tags/section:** AI assistants / self-hosted

**Markdown fallback** (if a section still takes list entries):
```md
- **[SAM](https://github.com/richhabits/sam)** - Personal AI assistant that runs on your own machine; keys, memory and data stay local, nothing leaves in offline mode, zero telemetry.
```
**PR title:** `Add SAM (private, local-first AI assistant)`
**PR body:**
> SAM is a personal AI assistant that runs locally. Keys, memory and files stay on-device; in offline mode
> (local Ollama) nothing leaves the machine; zero telemetry, no phone-home. MIT-licensed. Fits the AI/assistants
> section. https://github.com/richhabits/sam

**Watch:** state the **privacy property** concretely (local data, offline, no telemetry) — that's the bar here.

---

## 4. awesome-selfhosted — `awesome-selfhosted/awesome-selfhosted`  ⚠️ eligible, but the trickiest fit

Strict format, **alphabetical**, must be maintained + reasonably mature. **Do NOT use "free" or "open-source"
in the description** (the whole list is FOSS — they reject those adjectives). Needs `License` + `Language`.
```md
- [SAM](https://github.com/richhabits/sam) - Personal AI assistant that runs on your own machine with 173 tools and a team-of-agents mode; routes to a local Ollama model or your own cloud API keys, with an ask-first safety gate on dangerous actions. ([Source Code](https://github.com/richhabits/sam)) `MIT` `Nodejs`
```
**PR title:** `Add SAM`
**PR body:**
> Adds SAM under the AI/assistant area. It runs on the user's own machine (desktop app / local server on
> 127.0.0.1), stores keys + memory locally, and can run fully offline against a local Ollama model.
> MIT, Node.js/TypeScript, actively maintained. https://github.com/richhabits/sam

**Watch (read this before filing):** awesome-selfhosted leans toward **server software you self-host**, and
SAM is primarily a **local desktop app** — a maintainer may question the fit. Lead with the fact that the
backend is a local server (`127.0.0.1:8787`) you run yourself and can reach from other devices over your
own network/Tailscale. Pick the section carefully (there isn't a clean "AI assistant" category — check
whether one now exists before defaulting to Automation/Personal-Dashboards). **This is the one most likely
to get pushback — file it last, and be ready to make the self-hosting case.**

---

## 5. awesome-electron — `sindresorhus/awesome-electron`  ✅ eligible (high bar)

Under **Apps → Open source**, **alphabetical**. sindresorhus rules: description must **not** start with
"A/An/The", no marketing words, end with a period.
```md
- [SAM](https://github.com/richhabits/sam) - Private, local-first personal AI assistant with a system-wide ⌥Space overlay that routes to a local model first.
```
**PR title:** `Add SAM`
**PR body:**
> SAM is an MIT-licensed Electron desktop app (macOS/Windows/Linux): a private, local-first personal AI
> assistant with a global ⌥Space / Alt+Space overlay. Signed builds, actively maintained.
> https://github.com/richhabits/sam

**Watch:** the strict description style (no leading article, no adjectives like "powerful/amazing", ends
with a period) — sindresorhus's linter and reviewers are exacting. Alphabetical placement matters.

---

## Filing order & sequencing
1. Publish the **v1.6.0 release** + record the **demo GIF** first (front page must be whole).
2. File the **easy wins** first (ai-agents, local-ai, electron), then **privacy**, then **selfhosted** last
   (highest chance of discussion).
3. One PR per list, one commit each, alphabetical, neutral description. Never bulk-submit.
