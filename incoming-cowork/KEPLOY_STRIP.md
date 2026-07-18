# Stripping Keploy — NEXT for a build (a real tool, but adopt-not-embed, with friction here)

*Source: [keploy/keploy](https://github.com/keploy/keploy) — Apache-2.0, Go. "API tests faster
than unit tests, from user traffic." Uses **eBPF** at the network layer to record real API/DB/
queue traffic, then replays it as integration tests + data mocks. Language-agnostic (network
interception, so it covers Node too). AI coverage-expansion from recordings + OpenAPI schemas.
Explicitly an **external infrastructure tool, not a library you embed.***

## Verdict: NEXT — nothing to build; a filed adoption option with real caveats

Keploy is genuinely good and popular. But three facts make it a "next" for *making SAM*, not a
dismissal of the tool:

1. **It's not a component — it's infra you run alongside the app.** `keploy record` / `keploy
   test` wrap your running server. There's no code to strip into SAM; you'd *adopt* it, not
   build it. That's a CI/testing-ops decision, not a capability to own.

2. **eBPF = Linux kernel. SAM is a local macOS/electron app.** This is the sharp mismatch:
   Keploy's model assumes a server deployed in Linux/Docker/K8s — exactly the cloud-service
   shape SAM *isn't*. Recording SAM running natively on Romeo's Mac means going through
   Docker/Linux, which is real friction for a local-first desktop app. Keploy is built for the
   deployment model SAM deliberately doesn't have.

3. **Its core idea — record-replay mocks — SAM already achieves in-code.** SAM's tests use
   **dependency injection** for exactly this: `mockRun` in `models.ts`, injected `AnswerFn`/
   `JudgeFn` in the colosseum, the injected `llm` in the webintel-extract we just built. That's
   the deterministic-external-calls pattern Keploy sells, done cleaner (in-language, no eBPF,
   no captured-traffic files) and already covering SAM's real external surface (LLM brains, MCP).

## The honest "if you ever want it"

SAM *does* have an Express API (`/api/*`). If endpoint **integration-test coverage** ever
becomes a concern, Keploy against SAM's server-in-Docker would auto-generate integration tests
from real traffic — a legitimate option to *adopt then*, wired through the same CI you already
run (and it'd feed the reviewdog pipe). Filed, not built, and not urgent — SAM's unit coverage
is already strong.

## FLIP IT

Nothing. Flip-it has no API server, no DB, no queues — the only external call is the market-data
fetch, and that's already made deterministic with synthetic data + network-test deselection.
eBPF/Linux friction on top. No fit.

## BOARD paste block

```
- Keploy stripped (KEPLOY_STRIP.md): NEXT for a build — eBPF record-replay API-testing tool;
  it's external infra (adopt, not embed), assumes a Linux/Docker/K8s server (SAM is local
  macOS/electron = architectural mismatch), and its record-replay-mock idea SAM already does via
  dependency injection (mockRun, injected AnswerFn/JudgeFn, injected llm). Filed adoption option:
  Keploy vs SAM's Express API in Docker IF integration-test coverage ever matters. FLIP IT:
  nothing (no API/DB; data fetch already deterministic via synthetic). Zero code.
```
