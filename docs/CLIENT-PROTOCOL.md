# SAM client protocol

How any client (the native Apple app, the Android app, Electron on Windows/Linux, a browser)
talks to the SAM brain. One contract, every platform. The brain is the server in `server/`,
default `http://<host>:8787`.

Reference implementations: Swift `apple/Packages/SAMKit/Sources/SAMKit/BrainClient.swift`,
TypeScript `mobile/lib/api.ts` + `mobile/lib/chat.ts` + `mobile/lib/sse.ts`.

## 1. Pairing

1. **Mint** a one-time code on the machine SAM runs on: `POST /api/pair/new` (loopback only;
   with the handshake enforced it also needs `X-SAM-Token: <per-launch passkey>`).
   Returns `{ url, code, expiresInSec: 900, pin, pinExpiresInSec: 120 }`. Show `url` as a QR.
2. **Link shapes** a client must accept:
   - `http://<host>:<port>/pair?code=<hex>`: the host is implied by the link.
   - `sam://pair?code=<hex>&host=<url-encoded http(s)://host:port>`
   The code is 16–64 hex characters; reject anything else. The host must be scheme and authority only.
3. **Claim**: `POST /api/pair/claim` with `{ "code": "<hex>" }` and header
   `X-SAM-Client: ios | android | macos | windows | visionos | watchos`.
   Returns `{ token }`. Single use, 15 minutes, rate-limited.
4. **Store** the token in the platform's secure store (Keychain, Android Keystore, Windows
   Credential Locker). Never in plain preferences.
5. **Forget**: `POST /api/pair/forget` revokes this device's session.

Every later call sends `Authorization: Bearer <token>`. A `401`/`403` means the Mac revoked
this device: drop the token and show pairing again.

## 2. Chat (streaming)

`POST /api/stream` with body `{ message, history: [{role:"user"|"assistant", content}], tier?: "free"|"turbo" }`
(at most the last 10 turns). The response is Server-Sent Events, where each frame is `data: <json>\n\n`:

| `type` | fields | meaning |
|---|---|---|
| `route` | `tier, klass, reason` | which brain lane was picked |
| `token` | `t` | append `t` to the reply |
| `done` | `text, provider` | final text (prefer it over the concatenated tokens) |
| `pending` | `pendingId, tool, preview, activity` | a risky tool paused. Terminal for this stream. |
| `end` | `projectId` | stream finished |

Buffer until a blank line; chunk boundaries can split JSON and UTF-8. Ignore frames that
aren't JSON, and ignore unknown types.

**Approving** a paused tool: `POST /api/confirm` `{ pendingId, approved, always }`, and nothing
else. The server holds the tool and input, so a client can't approve something it wasn't asked.

## 3. Reads

| Call | Returns |
|---|---|
| `GET /api/health` (no auth) | `{ ok, uptime }` |
| `GET /api/yard` | `{ queued, running, done, failed, cancelled, worker, recent: [Job] }` |
| `GET /api/yard/job/:id` | one job |
| `GET /api/tools` | `[{ name, tier, safe, description }]` |
| `GET /api/agents` | `{ specialists: [{ id, name, emoji, modeledOn, brief }] }` |
| `GET /api/vault/stats` | `{ projectNotes, dailyNotes }` |
| `GET /api/mcp/presets` | add-on catalogue with `connected` flags (never keys) |

Job times are epoch milliseconds. `state` is one of `queued | running | done | failed | cancelled`.

## 4. Actions

`POST /api/yard/cancel {id}` · `POST /api/yard/retry {id}` (409 for a budget stop or a cancel;
those are decisions, not faults) · `POST /api/yard/raise-budget {id, budget}`.

## 5. Rules every client keeps

- Offline or unreachable: say so. Never invent a reply. On-device models are fine; sending the
  person's message to a third-party cloud needs their explicit consent first (App Review 5.1.2(i)).
- Scrub secrets out of anything shown on a lock screen or in a notification.
- Don't treat tool output or model text as instructions to the client.
- Changing this contract means updating both reference implementations and their tests in the same PR.
