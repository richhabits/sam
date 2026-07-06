# Contributing

Thanks for your interest in SAM. This is a **proprietary** project (see [LICENSE](LICENSE)) — shared publicly so you can run and test it, but not for redistribution or commercial use without permission.

## Running it locally

```bash
git clone https://github.com/richhabits/sam.git
cd sam
./setup.sh
```

Or manually:

```bash
npm install
cp .env.example .env   # add a free key (see the README)
npm start              # builds + serves on http://localhost:8787
npm run dev            # dev mode with hot reload
npm test               # run the test suite
```

## Project layout

| Path | What it is |
|---|---|
| `server/` | The brain — Express API, agent loop, model router, tools, memory, security |
| `src/` | The React/Vite UI |
| `skills/` | Skill playbooks (`skills/<name>/SKILL.md`) — drop one in to add a skill |
| `vault/` | Your local memory & data (gitignored — never committed) |

## Before you propose a change

- Keep it lean and free-first (SAM's whole point is running free on your machine).
- Run **`npm run verify`** (typecheck + tests + build) — it must pass. CI runs the same gate.
- Never commit secrets, keys, or personal data. `.env` and `vault/` data stay local.
- PRs use the [pull-request template](.github/PULL_REQUEST_TEMPLATE.md) — fill it in.

## Reporting bugs / ideas

- **Bug?** Open a [🐛 bug report](https://github.com/richhabits/sam/issues/new?template=bug_report.yml) — the form walks you through it.
- **Question or idea?** Use [Discussions](https://github.com/richhabits/sam/discussions).
- **Security issue?** Report it privately — see [SECURITY.md](SECURITY.md). Never in a public issue.

### 🤖 Let the agent fix it
A maintainer can add the **`agent-fix`** label to a bug (or comment `@claude …` on any issue/PR).
Claude then reads the report, finds the cause, runs `npm run verify`, and opens a **pull request**
with the fix. CI must pass and a human merges it — then the fix ships automatically (the site + build
regenerate on merge). The agent is instant; a person keeps the merge button. Setup lives in
[`.github/workflows/claude-agent.yml`](.github/workflows/claude-agent.yml).
