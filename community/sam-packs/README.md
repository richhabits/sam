# SAM Packs 📦

Community bundles for [SAM](https://github.com/richhabits/sam) — shareable skills, prompts, watched-folder templates, and (safety-gated) forged tools. A `.sampack` is signed JSON; **importing one never auto-installs anything** — SAM shows you exactly what's inside, runs a static safety scan + sandbox test on any tool code, and installs only what you approve (tools land disabled for you to review).

> This repo is the **read-only index** the SAM app browses. There's no server — the app fetches `index.json` directly.

## Use a pack
In SAM → **Settings → Packs → Browse community**, or import a `.sampack` file directly. Review the contents, approve, done.

## Contribute a pack
1. Export one from SAM (**Settings → Packs → Export**) — it's signed with your local key.
2. Add the file under `packs/` and an entry in `index.json`.
3. Open a PR. **CI runs `validate.mjs`** — it checks the format and runs the *same static safety scan SAM uses* (no eval/require/process/shell/ambient-fetch/…, capabilities must be declared). A tool that fails the scan blocks the merge.

## Safety model
- **Signed** proves a pack wasn't tampered in transit — it does **not** grant trust.
- **Every import is gated** by SAM's forge pipeline (scan → sandbox → show code → you approve).
- **Forged tools** carry declared capabilities: `net`/`fs:write` become dangerous-tier (always ask); shell is forbidden.
- Nothing here can add a watched folder, enable a tool, or run anything on its own.

## Local validation
```bash
node validate.mjs        # validates every packs/*.sampack
```

MIT-licensed, like SAM.
