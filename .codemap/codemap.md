<!--
  This file:        .codemap/codemap.md   (written report)
  Interactive map:  .codemap/codemap.html
-->

# SAM — Functional Module Quality Audit

> **Interactive view:** [`.codemap/codemap.html`](codemap.html) — per-module scores, findings, LoC, and the dependency graph. This file is the written report.

**Generated:**  · **Modules:** 10 · **Size:** 20258 tracked LoC across 56 files

## Health by layer

| Layer | Modules | Avg score |
|---|--:|--:|
| client | 1 | 82 |
| api | 1 | 40 |
| engine | 3 | 71 |
| tools | 2 | 78 |
| core | 3 | 91 |

## Per-module lines of code & score

_LoC is the representative file/folder per module; folder-level modules overlap and are not additive._

### client

| Module | LoC | Score | Tags |
|---|--:|:--|:--|
| Client App | 12,063 | 82 B | bloat, any-escape |

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
| LLM Providers | 1,156 | 85 B | bloat |
| Memory Vault | 207 | 95 A | — |
| Settings & Authz | 174 | 92 A | — |

## Worst offenders

- **API Server (40/D)** — /scrub.ts:1: Uncaught exception will not be handled.
- **Proactive Brain (60/C)** — server/proactive.ts: // ─────────────────────────────────────────────────────────────
//  S.A.M. · PROACTIVE  — the "alive" layer
//  A morning brief + nudges that reach out to you first. Slim:
//  one light timer (checks every 5 min), nudges in a local file,
//  the brief composed once a day. Delivered as a macOS notification
//  (works even if the window's closed) + queued for the app.
- **Tool Registry (68/C)** — server/tools.ts:2970: This single file (server/tools.ts) is 2970 lines long, which is a clear indicator of a God component anti-pattern, making it difficult to maintain, test, and understand. This is a severe architectural issue.
- **Swarm Orchestrator (75/B)** — server/swarm.ts: The module uses a lot of magic strings, which can make it harder to maintain.
- **Agent Loop (78/B)** — server/agent.ts: maxSteps function is complex and may be over-fitting.
- **Client App (82/B)** — src/App.tsx:1: App.tsx contains over 600 lines of complex UI state and logic that could be decomposed.
- **LLM Providers (85/B)** — server/models.ts:1: models.ts is approaching 1,000 lines, mixing provider definitions with the core execution engine.
- **MCP Integration (88/B)**
- **Settings & Authz (92/A)**
- **Memory Vault (95/A)**

## All findings

### HIGH (4)

- **API Server** · `/scrub.ts:1` — Uncaught exception will not be handled.
- **Tool Registry** · `server/tools.ts:2970` — This single file (server/tools.ts) is 2970 lines long, which is a clear indicator of a God component anti-pattern, making it difficult to maintain, test, and understand. This is a severe architectural issue.
- **Tool Registry** · `server/tools.ts:63` — The comment states that 'Heavy CJS/native deps (pdf-parse, mammoth, playwright) are lazy-loaded at call time via require'. While lazy loading can improve startup time, mixing `import` and `require` in a modern ESM module for core dependencies creates a dual-format problem and can lead to module resolution complexities, especially for a module acting as a central registry.
- **Tool Registry** · `server/tools.ts:68-124` — The module imports an extremely large number of other modules, each representing a distinct tool or capability. This indicates a severe violation of the Single Responsibility Principle and promotes tight coupling, making `server/tools.ts` a "God component" that orchestrates nearly every other part of the system. This centralizes failure points and complicates independent development and testing of features.

### MED (11)

- **Client App** · `src/App.tsx:1` — App.tsx contains over 600 lines of complex UI state and logic that could be decomposed.
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
- **LLM Providers** · `server/models.ts:1` — models.ts is approaching 1,000 lines, mixing provider definitions with the core execution engine.

### LOW (2)

- **Swarm Orchestrator** · `server/swarm.ts` — The module uses a lot of magic strings, which can make it harder to maintain.
- **Tool Registry** · `server/tools.ts:133` — The `samLlm` constant uses `runModel("free", ...)` directly. While the comment explains the rationale, this hardcoded string "free" could be prone to typos or lack flexibility if the pricing tiers change in the future. A constant or enum would be more robust.

