# Launch-day runbook (first 72h)

The headline numbers (from `docs/BENCHMARKS.md`): **~86% cheaper, ~46% faster per task than v1.3, 100% free-or-local.** Lead with those; they're reproducible (`npm run bench`).

## What to monitor
| Signal | Where | Healthy | Act if… |
|---|---|---|---|
| ⭐ Stars | GitHub | rising | — |
| 🐛 Issues | GitHub issues | triaged < 4h (waking hours) | crash/install bug → hotfix to **beta** first |
| ☁️ Gateway spend | Cloudflare dashboard (`total:calls`, daily `g:` keys) | < the `$25/mo` ceiling | approaching ceiling → it self-throttles; consider `PAUSED=1` if abuse |
| 💥 Crash reports | user-pasted diagnostic bundles in issues | few | a repeated stack → hotfix |
| 🔒 Security reports | GitHub Security Advisories (private) | none | triage immediately, fix before disclosure |

**Kill-switches ready:** gateway `PAUSED=1` (instant, no redeploy); `sam rollback` for users if an update breaks; beta channel absorbs risky fixes before stable.

## The 10 questions you'll get — pre-written answers

1. **"How is it actually free?"** — It routes to your **local** model first (Ollama) and to free cloud tiers (Groq/Cerebras/Gemini/…) otherwise, rotating across ~40 of them. No paid model unless you explicitly opt in. The benchmark shows 100% of a representative suite served free-or-local.
2. **"Is it really private / what leaves my machine?"** — Your keys, memory, vault, files and the life index stay local. Only the prompt you send goes to the brain you pick — and *nothing* leaves in offline/Ollama mode. No telemetry; the only network identity is an anonymous per-install id for the optional gateway. See SECURITY.md.
3. **"vs Ollama / Open WebUI?"** — Those give you a chat box on a local model. SAM is a **doer**: 170+ tools (web, files, terminal, email, GitHub), a system-wide ⌥Space overlay, an on-device file index, and it writes its own tools. Ollama is one of SAM's brains, not a competitor.
4. **"vs Cursor?"** — Cursor is AI *in your editor*. SAM is AI *across your whole computer* — same idea (index your stuff, act in-context), applied to files/apps/tasks, not just code.
5. **"Isn't a self-writing-tool feature dangerous?"** — Forged tools are static-scanned (no eval/require/shell), sandbox-tested (`node:vm`, nothing ambient), saved **disabled** for you to read, and only run in the sandbox. `net`/`fs:write` are dangerous-tier (always ask); shell can never be forged. See SECURITY.md.
6. **"Is the overlay a keylogger / reading my screen?"** — No. It captures your **current selection** only when *you* summon it (⌥Space), via a clipboard-swap that restores your clipboard after. Captured text is treated as untrusted and fenced.
7. **"Why should I trust the security of remote/phone access?"** — Off by default; when on, it uses **scoped tokens** (read-only / no-dangerous / full), hashed, revocable, with the most dangerous actions fenced to the local machine.
8. **"Windows says it's unsafe."** — Expected for an unsigned app (no publisher cert yet); it's the exact CI-built binary. Verify the SHA-256 from the release notes. Signing is on the roadmap (docs/SIGNING.md).
9. **"Can I encrypt my data?"** — Yes, opt-in: passphrase → scrypt → AES-256-GCM, keychain auto-unlock, no recovery by design. Full-disk encryption still recommended for the DB layer. SECURITY.md.
10. **"How do I extend it / share setups?"** — SAM Packs: export/import signed bundles of skills, prompts and (safety-gated) tools. Community index at `richhabits/sam-packs` — PR your pack, CI validates it.

## Triage rota (first 72h)
- **Hour 0–12 (launch window):** check every 30–60 min. Reply to every top HN/PH/Reddit comment. Label issues `bug`/`question`/`feature`. Hotfixes → `release/v1.5` → beta channel.
- **Hour 12–72:** check ~3×/day. Batch feature requests into a v1.6 list. Promote the beta build to stable once it's had a clean ~day under real load.
- **Always:** never argue; lead with facts + a repro/benchmark. "That's fair — here's the number / here's how to check."
