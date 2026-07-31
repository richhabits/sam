// Shared HTTP guards. `isLoopback` lived in index.ts, where three route sections needed it and
// so could not be extracted. It is the gate on every privileged write in SAM — key material,
// config, tokens, vault passphrase — so it belongs in one place with its own tests rather than
// buried in a 1600-line file.
import { checkPasskey, handshakeEnforced } from "./handshake.ts";
import { verifyPairToken } from "./yard/pairing.ts";
import { validateSession, sessionTokenFromRequest } from "./pairing.ts";

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
//
// B1 — also allows the private mesh's own address range (100.64.0.0/10, RFC 6598 "shared address
// space" — the block a WireGuard-class overlay assigns its own devices from). Without this, a phone
// reaching SAM over the mesh gets exactly the same CORS/Host rejection phone-on-LAN access had before
// it was fixed: same bug, different range. The mesh is a narrower TRANSPORT than the LAN, not a
// looser one — see isYardTrusted/isPairedSession for the actual authorization boundary, unchanged.
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
  if (a === 100 && b >= 64 && b <= 127) return true;  // the mesh's own range, 100.64/10
  return false;
}

// Just the mesh's own slice of the check above, for picking which local interface to bind to
// (server/index.ts) — a plain dotted-quad test, not a Host-header string like isLocalOrPrivateHost.
export function isMeshAddress(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ""));
  if (!m) return false;
  const [a, b] = m.slice(1).map(Number);
  return a === 100 && b >= 64 && b <= 127;
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

/**
 * Whether a request must present the Handshake passkey before it is allowed to mutate.
 *
 * The subtle case is remote mode. Turning SAM_REMOTE on lets a phone reach the API, and a phone
 * carries no passkey — it proves itself later at the remote-token gate, which it only reaches
 * because this gate lets it past. That pass must apply to NON-loopback callers only: if remote
 * mode also waved loopback requests through, it would silently re-trust every local process on
 * the machine, undoing the one thing the Handshake exists to do. So loopback is held to the
 * passkey in remote mode exactly as in default mode; only the off-machine phone is deferred to
 * the token gate. Kept as a pure function so this rule is unit-tested, not buried in middleware.
 */
// The pairing ON-RAMP. A browser has no passkey — obtaining a way in is the entire point of
// pairing — so the request that STARTS pairing cannot itself demand one, or the feature deadlocks
// (this shipped broken from v3.0.0: enforced Handshake ON, and this POST refused every browser that
// tried to pair). It grants nothing on its own: it only queues a request a human must then approve
// IN THE APP with the passkey (/api/yard/pair/approve), and it is rate- and time-limited. approve /
// deny / pending / revoke stay gated. Its siblings (pair/status, pair/collect) are GETs, already open.
const PAIRING_ONRAMP = "/api/yard/pair/request";
// C2's equivalent open door for a native app: the exact same code-for-token exchange GET /pair
// does for a browser (single-use, 15-minute code — claimCode() itself is what's rate/time-limited,
// not this gate), just over POST+JSON because a native client has no cookie-bearing GET-redirect
// flow to use instead. Grants nothing but a session token; still can't reach anything privileged.
const CLAIM_ONRAMP = "/api/pair/claim";

export function passkeyRequiredForMutation(
  req: { method: string; path: string; socket: { remoteAddress?: string | null } },
  env: { enforced: boolean; remote: boolean },
): boolean {
  if (!env.enforced) return false;
  const mutating = req.method === "POST" || req.method === "PUT" || req.method === "PATCH" || req.method === "DELETE";
  if (!mutating || !req.path.startsWith("/api/")) return false;
  if (req.path === PAIRING_ONRAMP || req.path === CLAIM_ONRAMP) return false;    // the open doors: how an unpaired browser/app gets in
  if (env.remote && !isLoopback(req)) return false; // off-machine phone → deferred to the remote-token gate
  return true;
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

type CookieReq = { headers: Record<string, string | string[] | undefined> };

/**
 * A device that completed the Pairing (server/pairing.ts): a same-origin, HttpOnly,
 * SameSite=Strict session cookie the operator's own approval flow issued — OR, since C2,
 * the identical kind of session token carried as `Authorization: Bearer` instead, which is
 * how a native app (no browser cookie jar to share with its own HTTP client) presents the
 * same credential. Both carriers validate against the exact same session store; neither
 * loosens the other. Distinct from isTrustedLocal just above, which stays loopback-only on
 * purpose (see its pinned test in handshake.test.ts — Console, the Scope, and every shell/
 * file/camera-adjacent panel must NOT loosen). The yard treats a paired session as
 * equivalent trust, because a paired session is the only way a phone can reach it before
 * Movement B's transport exists.
 */
export function isPairedSession(req: CookieReq): boolean {
  return validateSession(sessionTokenFromRequest(req), Date.now());
}

/**
 * The yard's own door. On loopback: the passkey, always — never conditional on the global
 * Handshake setting, because creating a job means running commands on this machine. Off
 * loopback: a paired session. A deliberately temporary stand-in for a real per-device
 * capability tier (Movement B formalizes read/chat/assign vs. deploy/shell/spend grants);
 * for now a paired phone gets the same yard access as the desktop app. Never reaches
 * ~/flip-it either way — nothing here touches that path.
 */
export function isYardTrusted(req: { socket: { remoteAddress?: string | null }; headers: Record<string, string | string[] | undefined> }): boolean {
  if (isLoopback(req)) return checkPasskey(req) || !!verifyPairToken(req.headers?.["x-sam-pair"]);
  return isPairedSession(req);
}

/** The yard's READ routes (job list/detail, project browsing): the same trust as writes,
 *  plus isTrustedLocal's own Handshake-aware loopback path so the desktop app's read
 *  behaviour is unchanged from before this existed. */
export function isYardReadTrusted(req: { socket: { remoteAddress?: string | null }; headers: Record<string, string | string[] | undefined> }): boolean {
  return isTrustedLocal(req) || isPairedSession(req);
}
