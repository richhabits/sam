// Shared HTTP guards. `isLoopback` lived in index.ts, where three route sections needed it and
// so could not be extracted. It is the gate on every privileged write in SAM — key material,
// config, tokens, vault passphrase — so it belongs in one place with its own tests rather than
// buried in a 1600-line file.
import { checkPasskey, handshakeEnforced } from "./handshake.ts";

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

// SECURITY · CORS origin allowlist. Only same-origin + localhost (incl. the dev HUD on any port) may
// reach the local API from a browser — a random website you visit must not. A missing Origin (o == "")
// is a non-browser/same-origin request and is allowed; anything else must be an http(s) localhost URL.
export function originAllowed(o: string | undefined): boolean {
  return !o || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

// SECURITY · anti-DNS-rebinding. CORS stops a cross-origin site READING our responses, but a rebinding
// attack (attacker.com re-pointed to 127.0.0.1) arrives "same-origin" — its only tell is the Host
// header, still the ATTACKER'S DOMAIN. Legit requests always carry a localhost/LAN-IP Host, so allow
// loopback + private-LAN IP hosts (covers phone access) and reject any domain-name Host outright.
export function hostAllowed(hostHeader: string): boolean {
  const h = (hostHeader || "").split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1") return true;
  return /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h);
}

// Loopback position is NOT authorization on its own — a local non-browser process passes isLoopback
// too (CORS only binds browsers). When control-token enforcement is on, a privileged caller must ALSO
// present the per-launch secret the legit frontend holds. Off (default): loopback alone, unchanged.
// See control-token.ts for the rationale.
export function isTrustedLocal(req: { socket: { remoteAddress?: string | null }; headers: Record<string, string | string[] | undefined> }): boolean {
  if (!isLoopback(req)) return false;
  if (handshakeEnforced()) return checkPasskey(req);
  return true;
}
