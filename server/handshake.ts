// ─────────────────────────────────────────────────────────────
//  S.A.M. · CONTROL-CHANNEL TOKEN  — loopback position is NOT authorization.
//
//  Reachable is not authorized: a control channel that trusts callers by network position alone
//  can be driven by any local process. SAM already blocks the REMOTE vectors
//  (CORS origin allowlist + Host-header anti-DNS-rebinding), but a LOCAL non-browser process
//  (another app, a supply-chained dependency) still passes `isLoopback` and — since CORS binds
//  only browsers — can drive the privileged file/shell API. It knows no secret it must present.
//
//  This adds a per-launch secret the legit frontend holds (delivered via Electron preload, which
//  a random local process cannot read) and must send on privileged routes. Enforcement is OPT-IN
//  (SAM_REQUIRE_CONTROL_TOKEN=1) until the frontend reliably attaches it everywhere — off by
//  default changes nothing. When on, loopback alone is insufficient.
// ─────────────────────────────────────────────────────────────
import { randomBytes, timingSafeEqual } from "node:crypto";

// The per-launch secret. Set once by preboot (Electron) so the renderer's preload reads the SAME
// value; a standalone server mints its own (valid secret, just not shared with any frontend — fine,
// because enforcement is opt-in). Read from process.env so main + preload + server all agree.
export function passkey(): string {
  if (!process.env.SAM_CONTROL_TOKEN) process.env.SAM_CONTROL_TOKEN = randomBytes(32).toString("hex");
  return process.env.SAM_CONTROL_TOKEN;
}

/** Enforcement is opt-in: off = the existing loopback gate is unchanged; on = the token is required. */
export function handshakeEnforced(): boolean {
  return process.env.SAM_REQUIRE_CONTROL_TOKEN === "1";
}

interface HasHeaders { headers: Record<string, string | string[] | undefined> }

export function presentedPasskey(req: HasHeaders): string {
  const h = req.headers["x-sam-token"];
  return typeof h === "string" ? h : Array.isArray(h) ? h[0] ?? "" : "";
}

/** Constant-time check that the request carries the current per-launch token. */
export function checkPasskey(req: HasHeaders): boolean {
  const want = passkey();
  const got = presentedPasskey(req);
  // Length guard first: timingSafeEqual throws on unequal lengths, and comparing lengths leaks only
  // the (fixed, public) token length, never its bytes.
  if (got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
