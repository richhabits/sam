// Shared HTTP guards. `isLoopback` lived in index.ts, where three route sections needed it and
// so could not be extracted. It is the gate on every privileged write in SAM — key material,
// config, tokens, vault passphrase — so it belongs in one place with its own tests rather than
// buried in a 1600-line file.
import { checkPasskey, handshakeEnforced } from "./handshake.ts";
import { verifyPairToken } from "./yard/pairing.ts";

/**
 * True only for a request that arrived from this machine.
 *
 * Deliberately an exact-match whitelist of the three forms Node actually produces, NOT a
 * prefix or range check. `127.0.0.0/8` is entirely loopback, so `startsWith("127.")` would be
 * *more* correct in the abstract — but the class of bug that matters here is a non-local
 * address being accepted, and every unrecognised form fails CLOSED. A rejected local request is
 * a visible annoyance; an accepted remote one hands over the user's keys.
 *
 * Note this reads `socket.remoteAddress` and never a header. `X-Forwarded-For` is attacker-
 * controlled, so trusting it would let anyone on the internet claim to be localhost.
 */
export function isLoopback(req: { socket: { remoteAddress?: string | null } }): boolean {
  const ip = req.socket.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

// A hostname that belongs to this machine or its private LAN: loopback, localhost, or an RFC-1918 /
// link-local IP. Phone access serves the HUD from the machine's LAN IP (e.g. 192.168.0.252), so both
// the CORS origin check and the anti-rebinding host check must treat these as ours — keeping them on
// ONE helper is deliberate: they drifted apart once (host allowed the LAN, origin didn't) and that
// silently broke phone access — every API call from the phone HUD was CORS-blocked as "unexpected".
function isLocalOrPrivateHost(h: string): boolean {
  const host = (h || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  // Must be a FULL, anchored IPv4 — not a prefix. "192.168.0.252.evil.com" starts with "192.168."
  // but is an attacker-controlled DOMAIN, and an un-anchored prefix test would wrongly accept it.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  if (a === 127) return true;                         // loopback 127/8
  if (a === 10) return true;                          // private 10/8
  if (a === 192 && b === 168) return true;            // private 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true;   // private 172.16/12
  if (a === 169 && b === 254) return true;            // link-local 169.254/16
  return false;
}

// SECURITY · CORS origin allowlist. Only same-origin, localhost (incl. the dev HUD on any port), and
// this machine's own private-LAN address (phone access) may reach the local API from a browser — a
// random website you visit must not. A missing Origin (o == "") is a non-browser/same-origin request
// and is allowed; anything else must be an http(s) URL whose host is local or private-LAN. The remote-
// token gate (SAM_REMOTE) still guards every non-loopback request, so allowing the LAN origin here
// lets the phone HUD READ responses without weakening auth — the token is still required.
export function originAllowed(o: string | undefined): boolean {
  if (!o) return true;
  // Host is either a bracketed IPv6 literal ([::1]) or a normal colon-free host, optionally :port.
  const m = /^https?:\/\/(\[[^\]]+\]|[^/:]+)(?::\d+)?$/.exec(o);
  return !!m && isLocalOrPrivateHost(m[1]);
}

// SECURITY · anti-DNS-rebinding. CORS stops a cross-origin site READING our responses, but a rebinding
// attack (attacker.com re-pointed to 127.0.0.1) arrives "same-origin" — its only tell is the Host
// header, still the ATTACKER'S DOMAIN. Legit requests always carry a localhost/LAN-IP Host, so allow
// loopback + private-LAN IP hosts (covers phone access) and reject any domain-name Host outright.
export function hostAllowed(hostHeader: string): boolean {
  return isLocalOrPrivateHost((hostHeader || "").split(":")[0]);
}

// Loopback position is NOT authorization on its own — a local non-browser process passes isLoopback
// too (CORS only binds browsers). When control-token enforcement is on, a privileged caller must ALSO
// present the per-launch secret the legit frontend holds. Off (default): loopback alone, unchanged.
// See control-token.ts for the rationale.
export function isTrustedLocal(req: { socket: { remoteAddress?: string | null }; headers: Record<string, string | string[] | undefined> }): boolean {
  if (!isLoopback(req)) return false;
  if (!handshakeEnforced()) return true;
  // The desktop app carries the per-launch passkey. A browser cannot — it has no way to
  // read it — so it may instead present a token from a pairing the operator approved
  // inside the app. Enforcing the Handshake without that second door would simply lock
  // every browser tab out of SAM's own panels.
  return checkPasskey(req) || !!verifyPairToken(req.headers?.["x-sam-pair"]);
}
