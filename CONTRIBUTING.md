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
- Run `npm test` and `npm run build` — both must pass.
- Never commit secrets, keys, or personal data. `.env` and `vault/` data stay local.

## Reporting bugs / ideas

Open an issue. For security problems, see [SECURITY.md](SECURITY.md) instead.
