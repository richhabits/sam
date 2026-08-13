<!--
  This file:        .codemap/codemap.md   (written report)
  Interactive map:  .codemap/codemap.html
-->

# SAM — Functional Module Quality Audit

> **Interactive view:** [`.codemap/codemap.html`](codemap.html) — per-module scores, findings, LoC, and the dependency graph. This file is the written report.

**Generated:**  · **Modules:** 10 · **Size:** 20185 tracked LoC across 55 files

## Health by layer

| Layer | Modules | Avg score |
|---|--:|--:|
| client | 1 | 68 |
| api | 1 | 40 |
| engine | 3 | 71 |
| tools | 2 | 78 |
| core | 3 | 73 |

## Per-module lines of code & score

_LoC is the representative file/folder per module; folder-level modules overlap and are not additive._

### client

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| Client App | 11,993 | 68 C | duplication, fallback, silent-except, bloat |

### api

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| API Server | 2,431 | 40 D | legacy, stub |

### engine

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| Agent Loop | 605 | 78 B | bloat, glue |
| Swarm Orchestrator | 333 | 75 B | monkeypatch, fallback, any-escape |
| Proactive Brain | 214 | 60 C | bloat, glue, any-escape |

### tools

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| Tool Registry | 2,969 | 68 C | god-component, bloat, duplication, silent-except |
| MCP Integration | 106 | 88 B | — |

### core

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| LLM Providers | 1,153 | 88 B | — |
| Memory Vault | 207 | 58 D | silent-except, bloat, duplication |
| Settings & Authz | 174 | 74 C | duplication, bloat, glue, any-escape |

## Worst offenders

- **API Server (40/D)** — /scrub.ts:1: Uncaught exception will not be handled.
- **Memory Vault (58/D)** — server/vault.ts:37: The `pruneOldLogs` function uses a silent catch block for `unlinkSync` and `statSync` operations, meaning individual file deletion errors or file stat errors are completely ignored, potentially leaving corrupted or unpruned files without any indication.
- **Proactive Brain (60/C)** — server/proactive.ts: // ─────────────────────────────────────────────────────────────
//  S.A.M. · PROACTIVE  — the "alive" layer
//  A morning brief + nudges that reach out to you first. Slim:
//  one light timer (checks every 5 min), nudges in a local file,
//  the brief composed once a day. Delivered as a macOS notification
//  (works even if the window's closed) + queued for the app.
- **Client App (68/C)** — src/App.tsx:63: The `visionErrorNote` function manually parses error objects (`e as { locked?: boolean; status?: number; message?: string }`). This indicates a lack of standardized error types from the `api` module, making error handling brittle and prone to type mismatches.
- **Tool Registry (68/C)** — server/tools.ts:2970: This single file (server/tools.ts) is 2970 lines long, which is a clear indicator of a God component anti-pattern, making it difficult to maintain, test, and understand. This is a severe architectural issue.
- **Settings & Authz (74/C)** — server/authz.ts:35: There is a duplicated code in the load function of authz.ts, where it calls mkdirSync and writeFileSync with the same parameters.
- **Swarm Orchestrator (75/B)** — server/swarm.ts: The module uses a lot of magic strings, which can make it harder to maintain.
- **Agent Loop (78/B)** — server/agent.ts: maxSteps function is complex and may be over-fitting.
- **MCP Integration (88/B)**
- **LLM Providers (88/B)**

## All findings

### HIGH (9)

- **Client App** · `src/App.tsx:63` — The `visionErrorNote` function manually parses error objects (`e as { locked?: boolean; status?: number; message?: string }`). This indicates a lack of standardized error types from the `api` module, making error handling brittle and prone to type mismatches.
- **Client App** · `src/main.tsx:21` — The global `window.fetch` monkeypatch handles `X-SAM-Token` and `X-SAM-Pair` headers. While solving a critical problem for `file://` and authentication, this global modification can lead to unexpected side effects or conflicts with other libraries that might also attempt to modify `fetch`.
- **API Server** · `/scrub.ts:1` — Uncaught exception will not be handled.
- **Tool Registry** · `server/tools.ts:2970` — This single file (server/tools.ts) is 2970 lines long, which is a clear indicator of a God component anti-pattern, making it difficult to maintain, test, and understand. This is a severe architectural issue.
- **Tool Registry** · `server/tools.ts:63` — The comment states that 'Heavy CJS/native deps (pdf-parse, mammoth, playwright) are lazy-loaded at call time via require'. While lazy loading can improve startup time, mixing `import` and `require` in a modern ESM module for core dependencies creates a dual-format problem and can lead to module resolution complexities, especially for a module acting as a central registry.
- **Tool Registry** · `server/tools.ts:68-124` — The module imports an extremely large number of other modules, each representing a distinct tool or capability. This indicates a severe violation of the Single Responsibility Principle and promotes tight coupling, making `server/tools.ts` a "God component" that orchestrates nearly every other part of the system. This centralizes failure points and complicates independent development and testing of features.
- **Memory Vault** · `server/vault.ts:37` — The `pruneOldLogs` function uses a silent catch block for `unlinkSync` and `statSync` operations, meaning individual file deletion errors or file stat errors are completely ignored, potentially leaving corrupted or unpruned files without any indication.
- **Memory Vault** · `server/vault.ts:39` — The outer try-catch block in `pruneOldLogs` also silently ignores errors from `readdirSync`, which could hide critical issues like directory permissions or non-existent directories, leading to a false sense of successful pruning.
- **Memory Vault** · `server/vault.ts:98` — The `setTimeout` block in `logExchange` uses a silent catch, meaning any error during model import (`import('./models.ts')`), `runModel` execution, or subsequent file operations (e.g., `appendFileSync`) is completely ignored. This "fire and forget" approach can lead to data loss or inconsistent state without any logging or error reporting.

### MED (19)

- **Client App** · `src/Dashboard.tsx:43` — QR code generation logic is duplicated here and in `Admin.tsx`, leading to maintenance overhead and potential inconsistencies. This should be a shared utility.
- **Client App** · `src/Dashboard.tsx:64` — The `catch(() => { /* the next poll re-reads */ })` pattern in `refreshYard` and similar functions (`refreshActivity`) silences potential errors. While a poll might eventually correct the state, immediate feedback or logging is preferable for debugging and user experience.
- **Client App** · `src/Admin.tsx:55` — QR code generation logic is duplicated here and in `Dashboard.tsx`, leading to maintenance overhead and potential inconsistencies. This should be a shared utility.
- **Client App** · `src/Admin.tsx:75` — Multiple API calls use `catch(() => {/* best-effort */})` which silently swallows errors. While described as 'best-effort,' these errors could indicate critical issues, especially for calls like `getAdminConfig` where a failure is explicitly surfaced, contrasting with others.
- **Client App** · `src/App.tsx:94` — The `titleOf` function truncates titles at 42 characters and appends '…'. This is an arbitrary magic number; a named constant or configurable setting would improve readability and maintainability.
- **Client App** · `src/VoiceMode.tsx:162` — The data channel message handler `try { msg = JSON.parse(e.data); } catch { return; }` silently ignores malformed JSON messages. While preventing crashes, this could mask underlying issues with the `oai-events` data stream.
- **Client App** · `src/main.tsx:34` — The service worker registration uses `catch(() => {/* browser API unavailable */})` which silently suppresses errors. While the note explains the intent, any other service worker registration failure would also be silently ignored.
- **Client App** · `src/main.tsx:54` — The global `unhandledrejection` handler creates and appends a DOM element to `document.body`. This is a low-level DOM manipulation that tightly couples the error display to the global `window` object, bypassing React's component tree. A React portal or a dedicated error boundary component would be more idiomatic.
- **API Server** · `/server/index.ts:2432` — Unused import: 'node:os' in line 1
- **Agent Loop** · `server/agent.ts` — maxSteps function is complex and may be over-fitting.
- **Proactive Brain** · `server/proactive.ts` — // ─────────────────────────────────────────────────────────────
//  S.A.M. · PROACTIVE  — the "alive" layer
//  A morning brief + nudges that reach out to you first. Slim:
//  one light timer (checks every 5 min), nudges in a local file,
//  the brief composed once a day. Delivered as a macOS notification
//  (works even if the window's closed) + queued for the app.
- **Proactive Brain** · `server/proactive.ts` — // ── Nudge store ──
export function addNudge(text: string, due?: string): Nudge {
  const list = load<Nudge[]>(NUDGES, []);
  const n: Nudge = { id: Math.random().toString(36).slice(2, 9), text: String(text).slice(0, 200), due, done: false, notified: false, created: new Date().toISOString() };
- **Proactive Brain** · `server/proactive.ts` — // ── Delivery (cross-platform) ──
export function desktopNotify(title: string, msg: string) {
  const clean = msg.replace(/[#*`]/g, "").slice(0, 220);
  // Strip the chars that carry meaning in AppleScript/PowerShell/XML string contexts.
- **Tool Registry** · `server/tools.ts:16` — The `exec` and `execFile` from `node:child_process` are promisified without explicitly specifying an encoding in the promisified version, which can lead to issues with binary data or incorrect string interpretations. While `promisify` itself doesn't cause this, the subsequent usage might implicitly rely on default encodings.
- **Tool Registry** · `server/tools.ts:31` — The `walkFiles` function uses a generic `any[]` type for `entries`, which reduces type safety. A more specific type like `fs.Dirent[]` should be used.
- **Tool Registry** · `server/tools.ts:33` — The `walkFiles` function uses a silent catch block (`try { ... } catch { return out; }`) which swallows all errors during directory reading. This can hide important issues like permission problems or I/O errors, making debugging difficult.
- **Tool Registry** · `server/tools.ts:51` — The `findByContent` function uses a silent catch block (`try { ... } catch { /* unreadable file in a scan — skip it, keep scanning */ }`) for file reading errors. This can hide issues with file corruption or permissions, reducing the robustness of the file search.
- **Memory Vault** · `server/vault.ts:93` — The JSON parsing for extracted facts (`facts = JSON.parse(txt)`) uses a silent catch block, ignoring any malformed JSON returned by the model. This can lead to silently dropped facts if the model output is not perfectly formatted, hindering the memory extraction process without feedback.
- **Memory Vault** · `server/vault.ts:167` — The comment "Avoids scannin" is incomplete and indicates unfinished work or a lack of attention to detail.

### LOW (9)

- **Client App** · `src/Dashboard.tsx:32` — Untyped `useState<any>(null)` is used for `s`, `sec`, and `people`. Specific types should be defined to improve code clarity and prevent runtime errors.
- **Client App** · `src/Admin.tsx:84` — `biome-ignore lint/correctness/useExhaustiveDependencies` is used to suppress a valid linter warning. `refresh` is a stable function, but this suppression can hide legitimate dependency issues elsewhere.
- **Swarm Orchestrator** · `server/swarm.ts` — The module uses a lot of magic strings, which can make it harder to maintain.
- **Tool Registry** · `server/tools.ts:133` — The `samLlm` constant uses `runModel("free", ...)` directly. While the comment explains the rationale, this hardcoded string "free" could be prone to typos or lack flexibility if the pricing tiers change in the future. A constant or enum would be more robust.
- **Memory Vault** · `server/vault.ts:51` — The `logExchange` function duplicates `existsSync(file)` and `writeFileSync` logic. If `writeFileSync` fails, the `appendFileSync` call will also fail, but the check is redundant for normal operation. A simpler approach might be to just `appendFileSync` and handle the potential error (e.g., by ensuring the file exists before appending, or catching the error if it's not guaranteed).
- **Memory Vault** · `server/vault.ts:140` — The `recentLog` function iterates through all lines of today's file and then slices the result. It would be more efficient to read the file in reverse or process lines from the end to avoid unnecessary iteration over potentially large files, especially since only the last `limit` lines are needed.
- **Memory Vault** · `server/vault.ts:153` — The `recentExchanges` function also reads the entire file, splits it by '###', and then slices the blocks. While better than `recentLog`, processing the entire file before slicing could still be inefficient for very large daily logs. Reading blocks from the end might be more performant.
- **Settings & Authz** · `server/authz.ts:35` — There is a duplicated code in the load function of authz.ts, where it calls mkdirSync and writeFileSync with the same parameters.
- **Settings & Authz** · `server/authz.ts:47` — The DANGEROUS set has some security-sensitive tools that can be marked as safe without proper review or testing.

