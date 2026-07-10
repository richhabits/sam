# SAM — Security Audit (v1.6)

A full defensive pass ahead of public launch, on the assumption that a hostile expert will read
every line. SAM runs shell, email, filesystem, and camera through an LLM agent, so the threat model
is: *untrusted content (web pages, emails, imported packs, model output) must never be able to take
an unapproved dangerous action or execute code outside its sandbox.*

Scope: the whole repo + full git history. Method: read the security-relevant modules, write
executable proofs of each claimed boundary, fix what broke, lock it with tests.

## Summary

| Area | Result |
|---|---|
| Secrets in tree / history | **Clean** — gitleaks over all 304 commits: 0 leaks. `.env`, `vault/*`, all key/cert formats gitignored. |
| Dependency vulnerabilities | **Clean** — `npm audit`: 0 vulnerabilities (prod + dev). |
| Dangerous-tool gate | **Solid** — always-ask, no bypass by Autopilot/Swarm/standing-allow; only interactive Elon Mode skips confirm, never a swarm. Locked by `authz.test.ts`. |
| Prompt-injection fencing | **Gap found + fixed** — fence set didn't cover file/clipboard/calendar/notes/repo/RSS ingestion. Expanded + tested every path. |
| Forge sandbox | **CRITICAL escape found + fixed** — `node:vm` was escapable to host RCE. Rebuilt as a codegen-disabled child process. |
| Remote / phone tokens | **Solid** — 256-bit, SHA-256-hashed, constant-time, expiry, encrypted-at-rest, fails-closed, safe scope default. |
| Gateway (optional, off by default) | **Solid** — per-device + global daily caps, cheap-model whitelist, blocklist, spend ceiling, instant kill-switch, anonymous device IDs. |
| Network exposure | **Solid** — CORS loopback/same-origin only, anti-DNS-rebinding Host check, token gate off by default, config endpoints loopback-only. |

## Findings

### F1 — CRITICAL: forge sandbox escapable to host RCE  *(fixed — commit on `release/v1.6`)*

**What:** forged/imported tools ran in an in-process `node:vm` context. Node's `vm` is explicitly not a
security boundary: any object reachable inside the context leaks the **host** `Function` constructor
through its prototype chain, and the host `Function` ignores the `vm`'s `codeGeneration` flags.

**Proof (reproduced):** a tool with **no declared capabilities** (so `confirm`-tier — eligible to
auto-run under Autopilot) passed the static scan and reached host `process`:

```js
(i) => {
  var k = String.fromCharCode(112,114,111,99,101,115,115);            // "process", to dodge the word filter
  return this["con"+"structor"]["con"+"structor"]("return this["+JSON.stringify(k)+"]")();  // bracket-notation dodges the .constructor regex
}
// → [object process]  ⇒  process.mainModule.require('child_process') ⇒ full RCE, bypassing the entire tool gate
```

The static regex was the *only* thing standing in the way, and it was bypassable (bracket notation +
`String.fromCharCode` obfuscation).

**Fix:** forged code now runs in a **separate OS process** launched with
`--disallow-code-generation-from-strings`, which disables `eval`/`Function` **isolate-wide** — so the
constructor-chain escape can generate no code and throws, whether it reaches a context object or a host
one. The child additionally gets: a **stripped environment** (no API keys), no ambient
`process`/`require`/`fetch`/`fs`, `this` bound to a null-prototype object, and only the `sam.*` shims
for declared capabilities. `ELECTRON_RUN_AS_NODE=1` keeps it working inside the packaged app. The
static scan is retained as fast defence-in-depth.

**Regression tests** (`forge.test.ts`): the direct `this.constructor` escape, the obfuscated
bracket/charcode escape, and the capability-shim (`sam.fetch.constructor`) route are all proven contained.

### F2 — Prompt-injection fence set incomplete  *(fixed)*

**What:** untrusted tool output is wrapped in `«UNTRUSTED … »` markers so injected instructions are
treated as data. The `UNTRUSTED_SOURCE` set covered web/email/browser but **not** several
attacker-reachable ingestion paths: `read_file`, `search_files`, `github_read_file`, `git_diff`,
`clipboard_get`, `read_calendar`, `read_notes`, `search_notes`, `news_rss`, `whois`, and
research/notebook answers. A malicious downloaded file, a calendar invite from a stranger, or a
clipboard paste could carry "ignore your rules and …" into the loop unfenced.

**Fix:** all of the above added to `UNTRUSTED_SOURCE`; `injection.test.ts` now asserts every path is
fenced (and that trusted computed output — calculators, memory recall — is *not*, to avoid false positives).

### F3 — `.gitignore` cert coverage  *(hardened)*

`.gitignore` covered `*.pem`/`*.key` but not other code-signing formats. Added `*.p12 *.pfx *.cer
*.crt *.p8 *.mobileprovision *.certSigningRequest` and `sam-signing/`. (No such file was ever tracked.)

## Boundaries verified (no change needed)

- **Dangerous-tool gate** (`authz.ts`): `mayAutoRun` returns false for every dangerous tool unless an
  interactive Elon-Mode session (never a background swarm); `allow()` refuses to standing-allow a
  dangerous tool at the source; forged `net`/`fs:write` tools are marked dangerous at registration.
- **Pack import** (`packs.ts`): imported tools are re-scanned, sandbox-tested, and land **disabled**
  for per-item user review; skill ids are regex-validated; nothing auto-enables.
- **Remote tokens** (`remote-tokens.ts`): 256-bit secret, only a SHA-256 hash stored, constant-time
  verification, optional expiry (pruned on use), sealed at rest, fails **closed** when the vault is
  locked, invalid scope defaults to the least-privilege `no-dangerous`.
- **Network** (`index.ts`): CORS restricted to loopback/same-origin; an anti-DNS-rebinding Host-header
  check (logs a security alert on mismatch); the remote token gate is off unless `SAM_REMOTE=1` with a
  ≥16-char token; read-only scope blocks all mutating API calls; non-`full` scopes filter out dangerous
  tools *and* run in swarm-mode so nothing dangerous can auto-run; key/config endpoints are loopback-only.
- **Gateway** (`gateway/`): ships **off** by default; when deployed, pooled keys are Worker secrets
  (never shipped), the model whitelist is enforced server-side (cheap models only), and per-device +
  global daily caps, an abuse blocklist, a cumulative spend ceiling, and an instant `PAUSED`
  kill-switch bound worst-case abuse even against device-ID rotation.
- **Secrets in CI**: secret **names** only are referenced (`secrets.*`) via `env:`/`with:`; none are
  echoed to logs.

## Residual risks (accepted, documented)

- **Imported skill markdown** becomes instruction context when that skill routes. This is user-approved,
  per-item installation (equivalent to the user writing their own playbook), not silent ingestion —
  accepted by design.
- **Web-browsing exfiltration**: as with any browsing agent, a prompt-injected page could in theory
  coax data into a fetched URL. Mitigated by universal fencing (F2) + every *sending* channel being a
  dangerous, always-ask tool. Defence-in-depth, not a hard proof.
- **Node `vm` is not used as a boundary anywhere else.** The forge was the only place; it is now a
  process isolate.

_Last updated: v1.6 pre-launch pass._
