# Security

SAM is built local-first and safe by default. Here's the security model and how to report issues.

## Security model

- **Local-first.** Your API keys, memory and data live only on your machine (`.env` + `vault/`, both gitignored). Nothing is uploaded; SAM has no telemetry.
- **Ask-first.** Any risky action (sending a message, deleting, pushing code, running a shell command) pauses for your explicit approval. You can grant a standing "always allow" per action.
- **Catastrophic-command denylist.** A hard block prevents SAM from ever running destructive commands (e.g. `rm -rf /`, `mkfs`, disk overwrites) — even if approved.
- **Locked-down API.** The local API only accepts requests from `localhost` / same-origin, so a website you visit can't reach it (CSRF-style abuse is blocked).
- **Watchdog.** SAM logs and surfaces anything dodgy — blocked commands, requests from unexpected origins — in the Dashboard and via `security_check`.
- **No injection.** Every shell argument is escaped; user input never reaches a shell unquoted.

## Reporting a vulnerability

Found a security issue? Please **do not open a public issue.** Report it privately via GitHub Security Advisories (Security tab → "Report a vulnerability") so it can be fixed before disclosure.

Include: what you found, steps to reproduce, and the potential impact. You'll get a response as quickly as possible.
