# Security

SAM is built local-first and safe by default. Here's the security model and how to report issues.

## Security model

- **Local-first.** Your API keys, memory and data live only on your machine (`.env` + `vault/`, both gitignored). SAM has no telemetry and never phones home — the only thing that leaves your machine is the prompt (or photo) you send to the AI brain you pick, and nothing at all in offline/Ollama mode.
- **Ask-first.** Any risky action (sending a message, deleting, pushing code, running a shell command) pauses for your explicit approval. You can grant a standing "always allow" per action.
- **Catastrophic-command denylist.** A hard block prevents SAM from ever running destructive commands (e.g. `rm -rf /`, `mkfs`, disk overwrites) — even if approved.
- **Locked-down API.** The local API only accepts requests from `localhost` / same-origin, so a website you visit can't reach it (CSRF-style abuse is blocked).
- **Anti-DNS-rebinding.** Every request's `Host` header is checked — only loopback and private-LAN hosts are allowed. A DNS-rebinding attack (a malicious page re-pointing its domain at `127.0.0.1`) is rejected with a 403, because its `Host` is still the attacker's domain. This closes the classic "webpage silently drives your local server" takeover.
- **Loopback-only by default; token-gated when shared.** The server binds to `127.0.0.1` only. Phone/LAN access is opt-in (`SAM_REMOTE=1` + a strong token) and every non-loopback request must present that token. The most dangerous switch — **Elon Mode** (which bypasses every ask-first gate) — is **loopback-only** and can never be toggled from a remote device.
- **Resilient.** Global `unhandledRejection` / `uncaughtException` handlers keep SAM up if a single request misbehaves, instead of taking the whole assistant down.
- **Watchdog.** SAM logs and surfaces anything dodgy — blocked commands, unexpected origins, unexpected Host headers — in the Dashboard and via `security_check`.
- **No injection.** Shell arguments are escaped; user input never reaches a shell unquoted. osascript invocations sanitise single-quotes (notification strings) and escape newlines (AppleScript multi-line bodies) so user-controlled content can't inject extra shell or AppleScript statements. Regexes over user input are linear (no ReDoS — a 50 KB pathological input matches in <2 ms).
- **No HUD XSS.** SAM's reply renderer escapes all five HTML-sensitive characters (incl. quotes), so a crafted link/image URL echoed from a malicious web page cannot break out of an HTML attribute to inject a script or event handler. The served HUD also ships a strict Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, and `no-referrer` — defence-in-depth against injected scripts and clickjacking. The remote-access cookie is `HttpOnly; SameSite=Lax`.
- **Automation is identity-gated.** The GitHub auto-fix agent only runs for the repo owner / members / collaborators (plus the write-gated `agent-fix` label) — a stranger can't drive the code-writing agent on a public repo.
- **Phone / remote access is hardened.** Off by default (loopback-only). When you turn it on for your phone:
  - Every non-loopback request needs a **256-bit** random token (`crypto.randomBytes(32)`) — a symmetric secret, so it's **quantum-resistant** (Grover's algorithm only halves it to ~128-bit effective, which is infeasible). Compared with `timingSafeEqual`.
  - The token is **stripped from the URL** after first use (302 → clean path; auth moves to an `HttpOnly; SameSite=Lax` cookie) so it never lingers in history, bookmarks, or a Referer.
  - **Per-IP brute-force backoff** — 5 bad tokens from a device and it's locked out with exponentially growing cooldowns.
  - **Instant revocation** — "🔁 New token" rotates the secret live (all devices signed out, no restart); "🔴 Turn off" closes the LAN.
  - The **owner-only** actions (turn off / rotate / Elon Mode / MCP config) are **loopback-fenced** — a phone with a valid token still gets 403 on them, verified by test.

## Known limitations (honest residuals)

These are inherent trade-offs, documented rather than hidden:

- **Data at rest is not encrypted.** Your `vault/` (memory, photos, people) and `.env` (API keys) are plaintext on your disk. "Private" here means *nothing leaves your machine* — not *encrypted against someone who already has your disk*. Use full-disk encryption (FileVault/BitLocker) for that layer.
- **Web-browsing exfiltration.** `web_fetch` reads URLs automatically (that's core to answering questions). Like any web-browsing agent, a cleverly prompt-injected page could in theory get SAM to encode data into a URL it fetches. Mitigations: web content is always treated as untrusted *data, not instructions*; and every channel that actively *sends* — email, iMessage, code push — is **ask-first**, so nothing is delivered without your approval.
- **Shared-token trust.** In remote mode the token grants full owner-level access to whoever holds it (the standard self-hosted model). Per-person permission tiers aren't implemented; the most dangerous action (Elon Mode) is fenced to loopback regardless.

## Reporting a vulnerability

Found a security issue? Please **do not open a public issue.** Report it privately via GitHub Security Advisories (Security tab → "Report a vulnerability") so it can be fixed before disclosure.

Include: what you found, steps to reproduce, and the potential impact. You'll get a response as quickly as possible.
