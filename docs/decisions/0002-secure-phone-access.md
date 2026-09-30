# 0002 — Secure phone access without "remote mode"

- **Status:** proposed (2026-10-01)
- **Context owner:** Romeo turned remote mode off on 2026-09-30. Rightly: it served plain HTTP on
  every interface, guarded by one shared token, and it's the same surface that once let anyone on
  the network mint a pairing code.

## Problem

With remote off, SAM listens on `127.0.0.1` only. The native iPhone/iPad app, the widgets, Siri
and the Share/Safari extensions on those devices can't reach the brain, so they fall back to
Apple Intelligence on-device. We want the phone back without reopening a plain-HTTP LAN port.

## Decision

A separate, opt-in listener for paired devices only, encrypted and pinned. It does not replace
loopback, and it is not the old remote mode.

1. **`SAM_LAN=1` (default off)** starts a second listener: HTTPS on the LAN address (default port
   8788). Loopback on 8787 is unchanged.
2. **Self-signed certificate, pinned at pairing.** SAM generates an ECDSA P-256 key and certificate
   once, and stores them in `VAULT_DIR/tls/` (mode 600). The pairing QR / `sam://pair` link carries
   the certificate's SHA-256 fingerprint (`fp=`). The native client pins that fingerprint
   (URLSession delegate) and refuses anything else. No CA and no trust-on-first-use: the QR is the
   out-of-band channel.
3. **Only paired sessions pass.** On the LAN listener, every request needs a valid paired-session
   bearer token, except `POST /api/pair/claim` (one-time code, already rate-limited) and
   `GET /api/health`. Loopback-only routes stay loopback-only (the listener's socket is never
   loopback), and minting codes stays on the Mac.
4. **Discovery with Bonjour** (`_sam._tcp`, TXT `fp=<fingerprint>`), so the app finds the Mac
   without anyone typing an IP address. Discovery only helps you *find* it: trust still comes from
   the fingerprint in the QR.
5. **Kill switch.** Settings → Phone access: turning it off stops the listener, and "Forget all
   devices" revokes every session.

## Why not the alternatives

- **Old remote mode**: plain HTTP, and one bearer token shared across the whole LAN.
- **Tailscale mesh mode** (already exists): good, but it needs a third-party account and client on
  every device. It stays available as the off-network option.
- **A cloud relay**: puts a server we'd have to run between the person and their own Mac.

## Work

- Server: `server/lan-tls.ts` (key/cert creation, fingerprint), the listener and guard, `fp` in
  `/api/pair/new`, Bonjour advertisement, and tests for "unpaired → 401 on every route except
  claim/health".
- SAMKit: `PairLink` parses `fp`; `BrainClient` pins it with a `URLSessionDelegate`; `Session`
  stores it next to the host.
- Apple: the NSBonjourServices entry, a discovery list in `PairView`, and Local Network usage text.
- Docs: `CLIENT-PROTOCOL.md` gains the TLS + pinning rules, so Android can follow.
