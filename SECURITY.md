# Security

SAM is built local-first and safe by default. Here's the security model and how to report issues.

## Security model

- **Local-first.** Your API keys, memory and data live only on your machine (`.env` + `vault/`, both gitignored). Nothing is uploaded; SAM has no telemetry.
- **Ask-first.** Any risky action (sending a message, deleting, pushing code, running a shell command) pauses for your explicit approval. You can grant a standing "always allow" per action.
- **Catastrophic-command denylist.** A hard block prevents SAM from ever running destructive commands (e.g. `rm -rf /`, `mkfs`, disk overwrites) — even if approved.
- **Locked-down API.** The local API only accepts requests from `localhost` / same-origin, so a website you visit can't reach it (CSRF-style abuse is blocked).
- **Loopback-only server.** The HTTP server binds to `127.0.0.1` only — devices on the same Wi-Fi or LAN cannot reach the API even if they bypass the browser.
- **Watchdog.** SAM logs and surfaces anything dodgy — blocked commands, requests from unexpected origins — in the Dashboard and via `security_check`.
- **No injection.** Shell arguments are escaped; user input never reaches a shell unquoted. osascript invocations sanitise single-quotes (notification strings) and escape newlines (AppleScript multi-line bodies) so user-controlled content can't inject extra shell or AppleScript statements.

## Reporting a vulnerability

Found a security issue? Please **do not open a public issue.** Report it privately via GitHub Security Advisories (Security tab → "Report a vulnerability") so it can be fixed before disclosure.

Include: what you found, steps to reproduce, and the potential impact. You'll get a response as quickly as possible.
