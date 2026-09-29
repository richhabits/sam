# SAM — master prompt (ready to use, then implement)

Standing brief for any agent working in this checkout. Read this before editing.
The older `MASTER_PROMPT_ANTIGRAVITY.md` is historical (HQ path, Claude/Antigravity
split). This file replaces it.

## Where the product is

- Working tree: `/Users/romeovalentine/sam` (GitHub `richhabits/sam`, branch `main`).
- Do not use `/Volumes/ROMEO HQ/SAM` as the working copy.
- `HEAD` and `origin/main` are `85ec102` (webhook delivery through `safeFetch`).
- Node on this Mac is 22.23.2 (`engines.node` is `>=22.19.0`).
- Installed app: `/Applications/SAM.app`. `START-SAM.command` opens that app when it exists. Source mode is the fallback: server on port **8787**, HUD at `http://localhost:8787`.
- `package.json` version is **3.6.0**. `CHANGELOG.md` still tops out at **3.3.4**. Treat the changelog as behind the code, not as the product version.
- Phone bundle: `com.hectic.sam.mobile`. App Store Connect already has build **1.0.0 (7)** processed. Team `CC9Q9BH5NT`.

## What “ready to use” means

A person can do all four of these without reading the repo:

1. **Desktop.** Open SAM.app (or `./START-SAM.command`). The HUD loads. A message gets an answer from a free brain or local Ollama. No paid key is required for that path.
2. **Phone, no Mac.** The iOS app launches. Menu (•••) → Connect to Mac / PC → **Explore the demo**. Chat, tasks, attachments, and settings run from the local demo script. A banner stays up. No network.
3. **Phone + this Mac.** Pairing shows a QR, the phone joins, and a task started on the phone is visible on the desktop. A silent “success” that changes nothing is a failure.
4. **Store, only if asked to ship.** Listing copy and screenshot files already exist (below). What is left is App Store Connect clicks, not more product code.

Do not start a new feature until 1–3 are true on this machine, or you have written down exactly which step failed and why.

## Already true — do not rebuild

| Surface | Evidence |
|---|---|
| iPhone 6.9" store shots | `mobile/screenshots/iphone-6.9/` — seven PNGs, all **1320×2868**. `02`–`06` were upscaled from 1206×2622. Prefer `01-home.png` first. Recapture only if asked for sharper art. |
| iPad 13" store shots | `mobile/screenshots/ipad-13/` — six PNGs, all **2064×2752** (home, pairing, agent, tasks, settings, vault). `docs/store/README.md` still says this set is missing. That README is wrong. `docs/store/iphone-6.9/` is a separate framed desktop-style set. |
| Review notes, ATS, privacy URLs, draft metadata | `mobile/SUBMISSION.md` and `docs/APP-REVIEW.md`. ATS `NSAllowsArbitraryLoads` is required for Tailscale `100.x`. |
| Webhook SSRF | `85ec102` is already on `origin/main`. `docs/LAUNCH-GATES.md` is an untracked scratch note and is stale on that point. |

## Still open (in this order)

1. **Prove desktop use on this Mac.** Launch SAM.app. Send one message. Confirm a reply. If Ollama is the brain, `http://localhost:11434` must answer; `~/.ollama` is a symlink onto `/Volumes/ROMEO HQ/_mac-offload/ollama`, so the HQ volume has to be mounted.
2. **Prove the phone demo.** Needs Simulator opened by Romeo (this agent session cannot open Simulator.app or sign). Do not erase or shut down PIING Test iPhone `4193A4BA-6BA4-4933-B017-D28FF7BE0C69`. SAM Test Max `32F82571-FD08-4663-A282-999606AAD9E4` was erased and must be recreated before a native recapture.
3. **Prove pairing** against the desktop that is actually running, not a fixture.
4. **App Store Connect, Romeo only.** Age-rating questionnaire (chatbot / AI content — answer honestly), upload the `mobile/screenshots/` sets, attach build **1.0.0 (7)**, paste the review note from `mobile/SUBMISSION.md`, sign-in required = No, then Submit. Creating the app via API returns 403. Issuer ID for the ASC API is not on disk; do not block product work on it.
5. **Desktop release.** A signed 3.6.x GitHub release is a ship task. Do not claim it shipped because `package.json` says 3.6.0. This session has no codesigning identity. Romeo archives from Terminal.

## How to implement

- Trace every change to a caller a user can reach. A route, flag, or component that nothing mounts is not done.
- Drive it once in the running app (SAM.app, `http://localhost:8787`, or the simulator). A green unit test is extra, not a substitute.
- If an operation reports success and changes nothing, that is the bug.
- Before editing, search for a second copy of the same handler. Tests have passed against the dead copy before.
- New behavior gets a test that imports the live module, then one live check.
- Tests use mocks or local Ollama. Do not spend paid model quota.
- Do not print secrets, `.env`, or keychain material.
- This agent cannot `git push`, `git reset --hard`, or `rm -rf` (DreamGuard). Give Romeo a pasteable Terminal command for those.
- Do not commit unless Romeo asks.
- This Mac has 8 GB RAM. Do not boot extra simulators beside PIING. Do not run `npm run verify` (typecheck + full test + production build) unless the task needs it. Prefer the narrowest test file.
- `npm run dev` is server + HUD. `npm start` builds first, then serves `dist/server.mjs`.

## Definition of done for a change

Say which of these you actually did:

- File(s) changed and the user-visible path that calls them.
- Command or UI step you ran, and what it returned.
- What you did not run.

“It compiles” is not done. “Tests passed” is not done if the live path was not exercised.
