// ─────────────────────────────────────────────────────────────
//  S.A.M. · PHONE ACCESS — the pinned-TLS LAN listener (docs/decisions/0002).
//
//  Off by default. SAM_LAN=1 starts a SECOND listener: HTTPS, bound to this machine's LAN
//  address only (never 0.0.0.0, never loopback), serving the same Express app — but every
//  request that arrives on it passes lanGuard() FIRST, and lanGuard lets an unpaired device
//  reach exactly two things: GET /api/health (a bare liveness answer) and POST /api/pair/claim
//  (one-time code → session token; rate-limited). Everything else needs a paired-session bearer
//  token; the HUD/static site is not served here at all.
//
//  Loopback-only routes stay loopback-only for free: a LAN socket's remoteAddress is never a
//  loopback address, so isLoopback()/isTrustedLocal() refuse it whatever token it carries.
//
//  Trust comes from the certificate fingerprint, not from a CA: the pairing QR / sam:// link
//  carries the SHA-256 of the certificate and the native client pins exactly that. So the key
//  and certificate are made ONCE and reused — regenerating would change the fingerprint and
//  silently un-pair every phone. They are regenerated only when missing or unreadable.
//
//  The certificate is built here with node:crypto (ECDSA P-256 key, a minimal DER X.509 v3),
//  rather than a new dependency or a shell-out to openssl (which Windows does not ship).
// ─────────────────────────────────────────────────────────────

import { createHash, createPrivateKey, generateKeyPairSync, type KeyObject, randomBytes, sign, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { isIPv4 } from "node:net";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Bonjour } from "bonjour-service";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isPairedSession } from "./http-guards.ts";
import { createRateLimiter } from "./rate-limit.ts";

// ── config ────────────────────────────────────────────────────

export const DEFAULT_LAN_PORT = 8788;

/** SAM_LAN=1 turns phone access on. Anything else (unset, "0", "true") leaves it off. */
export function lanEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SAM_LAN === "1";
}

/** SAM_LAN_PORT, defaulting to 8788. An unusable value is null — the caller refuses to start. */
export function lanPort(env: Record<string, string | undefined> = process.env): number | null {
  const raw = (env.SAM_LAN_PORT ?? "").trim();
  if (!raw) return DEFAULT_LAN_PORT;
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 65535 ? n : null;
}

function tlsDir(): string {
  const vault = process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
  return join(vault, "tls");
}

// ── a minimal DER encoder — just the handful of types an X.509 v3 certificate needs ──

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const octets = (b: Buffer) => tlv(0x04, b);
const bits = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));   // 0 unused bits
const explicit = (n: number, inner: Buffer) => tlv(0xa0 | n, inner);
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, "utf8"));
const bool = (v: boolean) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
function uint(b: Buffer): Buffer {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;               // minimal encoding
  const v = b.subarray(i);
  return tlv(0x02, v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v);   // keep it positive
}
function oid(dotted: string): Buffer {
  const p = dotted.split(".").map(Number);
  const out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) {
    const chunk = [n & 0x7f];
    for (let v = Math.floor(n / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}
// RFC 5280 §4.1.2.5: UTCTime through 2049, GeneralizedTime from 2050.
function time(d: Date): Buffer {
  const iso = d.toISOString();   // YYYY-MM-DDTHH:MM:SS.sssZ
  const digits = iso.slice(0, 19).replace(/[-:T]/g, "");   // YYYYMMDDHHMMSS
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${digits.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${digits}Z`));
}

const OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
const OID_CN = "2.5.4.3";
const OID_SAN = "2.5.29.17";
const OID_BASIC_CONSTRAINTS = "2.5.29.19";
const OID_KEY_USAGE = "2.5.29.15";
const OID_EXT_KEY_USAGE = "2.5.29.37";
const OID_SERVER_AUTH = "1.3.6.1.5.5.7.3.1";

const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

/**
 * A self-signed ECDSA P-256 certificate: CN "SAM", 10-year validity, SAN = the given IPv4
 * addresses plus DNS "localhost", serverAuth only, not a CA. Returns PEMs.
 */
export function makeSelfSignedCert(ips: string[], now = new Date()): { keyPem: string; certPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const sigAlg = seq(oid(OID_ECDSA_SHA256));
  const name = seq(set(seq(oid(OID_CN), utf8("SAM"))));
  const serial = randomBytes(16);
  serial[0] &= 0x7f;   // positive
  serial[0] |= 0x40;   // and never leading zeros, so it stays 16 bytes
  const notBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);   // a day of slack for a phone whose clock is behind
  const notAfter = new Date(now.getTime() + TEN_YEARS_MS);
  const sanNames = [
    ...ips.filter((ip) => isIPv4(ip)).map((ip) => tlv(0x87, Buffer.from(ip.split(".").map(Number)))),   // [7] iPAddress
    tlv(0x82, Buffer.from("localhost")),                                                                 // [2] dNSName
  ];
  const extensions = seq(
    seq(oid(OID_SAN), octets(seq(...sanNames))),
    seq(oid(OID_BASIC_CONSTRAINTS), bool(true), octets(seq())),                          // cA FALSE
    seq(oid(OID_KEY_USAGE), bool(true), octets(bits(Buffer.from([0x80])))),              // digitalSignature
    seq(oid(OID_EXT_KEY_USAGE), octets(seq(oid(OID_SERVER_AUTH)))),
  );
  const tbs = seq(
    explicit(0, uint(Buffer.from([2]))),   // v3
    uint(serial),
    sigAlg,
    name,
    seq(time(notBefore), time(notAfter)),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    explicit(3, extensions),
  );
  const signature = sign("sha256", tbs, privateKey);   // DER-encoded ECDSA signature
  const der = seq(tbs, sigAlg, bits(signature));
  const b64 = der.toString("base64").match(/.{1,64}/g)!.join("\n");
  return {
    keyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    certPem: `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`,
  };
}

/** Lowercase hex SHA-256 of the certificate DER, no colons — the value the client pins. */
export function certFingerprint(certPem: string): string {
  return createHash("sha256").update(new X509Certificate(certPem).raw).digest("hex");
}

export interface LanCert { keyPem: string; certPem: string; fingerprint: string }

function readUsable(keyFile: string, certFile: string): LanCert | null {
  try {
    const keyPem = readFileSync(keyFile, "utf8");
    const certPem = readFileSync(certFile, "utf8");
    const cert = new X509Certificate(certPem);
    const key: KeyObject = createPrivateKey(keyPem);
    if (!cert.checkPrivateKey(key)) return null;   // a mismatched pair is as unusable as a missing one
    return { keyPem, certPem, fingerprint: certFingerprint(certPem) };
  } catch {
    return null;
  }
}

function tighten(path: string, mode: number): void {
  if (process.platform === "win32") return;   // POSIX modes don't apply; the vault dir's ACL does
  try { chmodSync(path, mode); } catch { /* best effort — never fatal */ }
}

/**
 * The LAN certificate, from `dir` (default VAULT_DIR/tls). Reused if present and readable;
 * otherwise created (SAN = `ip` + localhost) and stored as key.pem/cert.pem, mode 600, dir 700.
 * Not regenerated when the LAN IP changes: the client pins the fingerprint, not the address.
 */
export function loadOrCreateLanCert(ip: string | null, dir = tlsDir()): LanCert {
  const keyFile = join(dir, "key.pem");
  const certFile = join(dir, "cert.pem");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  tighten(dir, 0o700);
  const existing = existsSync(keyFile) && existsSync(certFile) ? readUsable(keyFile, certFile) : null;
  if (existing) {
    tighten(keyFile, 0o600);
    tighten(certFile, 0o600);
    return existing;
  }
  const { keyPem, certPem } = makeSelfSignedCert(ip ? [ip] : []);
  // Key first: a crash between the two writes leaves a key with no cert, which reads as
  // "missing" next boot and is regenerated — never a cert whose key is gone.
  writeFileSync(keyFile, keyPem, { mode: 0o600 });
  tighten(keyFile, 0o600);
  writeFileSync(certFile, certPem, { mode: 0o600 });
  tighten(certFile, 0o600);
  return { keyPem, certPem, fingerprint: certFingerprint(certPem) };
}

let cached: LanCert | null = null;

/** The pinned fingerprint of this machine's LAN certificate (creating it if needed). */
export function lanFingerprint(): string {
  if (!cached) cached = loadOrCreateLanCert(null);
  return cached.fingerprint;
}

// ── the guard ─────────────────────────────────────────────────

// Requests that arrived on the LAN listener. Set by the https server's own request handler —
// the only code that can put a request here — so no header, address or path can forge it,
// and a loopback request can never be in it.
const lanRequests = new WeakSet<object>();
export function markLanRequest(req: object): void { lanRequests.add(req); }
export function isLanRequest(req: object): boolean { return lanRequests.has(req); }

// "/api/../index.html" starts with "/api/" but a static handler would resolve it outside
// /api. Refuse dot segments (raw or percent-encoded) and backslashes outright on this listener.
function hasDotSegment(path: string): boolean {
  let p = path;
  try { p = decodeURIComponent(path); } catch { return true; }
  return p.includes("\\") || /(^|\/)\.\.?(\/|$)/.test(p);
}

/**
 * The LAN listener's front door. Registered as the app's FIRST middleware; a no-op for any
 * request that did not arrive on the LAN listener, so loopback behaviour is untouched.
 */
export function createLanGuard(isPaired: (req: Request) => boolean = isPairedSession): RequestHandler {
  // Stricter than the claim lockout inside pairing.ts (which counts only FAILED claims): this
  // caps every claim attempt from one LAN address, successful or not.
  const claimLimiter = createRateLimiter({ windowMs: 60_000, max: 10, message: "Too many pairing attempts from this device. Wait a minute and try again." });
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isLanRequest(req)) return next();
    const path = req.path;
    if (!path.startsWith("/api/") || hasDotSegment(path)) { res.status(404).json({ error: "not found" }); return; }
    if (req.method === "POST" && path === "/api/pair/claim") { claimLimiter(req, res, next); return; }
    const paired = isPaired(req);
    if ((req.method === "GET" || req.method === "HEAD") && path === "/api/health") {
      // Unpaired callers learn only that SAM is up — not routing history or cache stats.
      if (!paired) { res.json({ ok: true }); return; }
      return next();
    }
    if (!paired) { res.status(401).json({ error: "pair this device first" }); return; }
    next();
  };
}

// ── what /api/pair/new adds ──────────────────────────────────

export interface LanInfo { url: string; fingerprint: string }

/** The extra /api/pair/new fields when phone access is on; {} when it is off. */
export function pairNewLanFields(code: string, lan: LanInfo | null): { lan?: LanInfo; appLink?: string } {
  if (!lan) return {};
  return {
    lan: { url: lan.url, fingerprint: lan.fingerprint },
    appLink: `sam://pair?code=${encodeURIComponent(code)}&host=${encodeURIComponent(lan.url)}&fp=${lan.fingerprint}`,
  };
}

// ── the listener ─────────────────────────────────────────────

let server: HttpsServer | null = null;
let info: LanInfo | null = null;
let bonjour: Bonjour | null = null;

/** Where phone access is listening, or null when it is off / not (yet) listening. */
export function lanInfo(): LanInfo | null { return info; }

/**
 * Start the LAN listener if SAM_LAN=1. `handler` is the Express app. Never throws: phone
 * access failing to start must not take SAM down with it.
 */
export async function startLanListener(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
  opts: { ip: string | null; env?: Record<string, string | undefined>; bonjour?: boolean; tlsDirPath?: string; log?: (s: string) => void },
): Promise<LanInfo | null> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((s: string) => console.log(s));
  if (!lanEnabled(env) || server) return info;
  const port = lanPort(env);
  if (port === null) { log(`  ⚠️ phone access is off — SAM_LAN_PORT "${env.SAM_LAN_PORT}" is not a valid port.\n`); return null; }
  const ip = opts.ip;
  // Bind the LAN address itself or nothing. A missing address must never widen to 0.0.0.0.
  if (!ip || !isIPv4(ip) || ip.startsWith("127.") || ip === "0.0.0.0") {
    log("  ⚠️ phone access is off — SAM_LAN=1 but this Mac has no LAN address a phone could reach. Connect it to the same Wi-Fi as your phone and restart SAM.\n");
    return null;
  }
  let cert: LanCert;
  try { cert = opts.tlsDirPath ? loadOrCreateLanCert(ip, opts.tlsDirPath) : loadOrCreateLanCert(ip); }
  catch (e: any) { log(`  ⚠️ phone access is off — couldn't create its TLS certificate: ${e?.message || e}\n`); return null; }
  cached = cert;
  const srv = createHttpsServer({ key: cert.keyPem, cert: cert.certPem, minVersion: "TLSv1.2" }, (req, res) => {
    markLanRequest(req);
    handler(req, res);
  });
  const ok = await new Promise<boolean>((resolve) => {
    srv.once("error", (e: any) => {
      log(`  ⚠️ phone access is off — couldn't listen on ${ip}:${port}: ${e?.code || e?.message || e}\n`);
      resolve(false);
    });
    srv.listen(port, ip, () => resolve(true));
  });
  if (!ok) return null;
  srv.on("error", (e: any) => log(`  ⚠️ phone access listener error: ${e?.message || e}`));
  server = srv;
  info = { url: `https://${ip}:${port}`, fingerprint: cert.fingerprint };
  log(`  🔐 phone access · ${info.url} (paired devices only, pinned TLS ${cert.fingerprint.slice(0, 12)}…)\n`);
  if (opts.bonjour !== false) advertise(port, cert.fingerprint, log);
  // Every stop path in index.ts ends in process.exit(), so "exit" is the one hook they all pass
  // through. That hook is synchronous, so the mDNS goodbye it queues is best-effort: a client may
  // briefly list a stale "SAM on …" after a hard stop, and simply fails to connect to it. A live
  // stopLanListener() (no exit) withdraws the advertisement properly.
  process.once("exit", stopLanListener);
  return info;
}

// Discovery only — trust still comes from the fingerprint in the QR. Failure is logged, never fatal.
function advertise(port: number, fp: string, log: (s: string) => void): void {
  try {
    const b = new Bonjour(undefined, (e: any) => log(`  ⚠️ phone access · Bonjour error (discovery only, still reachable by address): ${e?.message || e}`));
    const svc = b.publish({ name: `SAM on ${hostname()}`, type: "sam", protocol: "tcp", port, txt: { v: "1", fp } });
    (svc as any)?.on?.("error", (e: any) => log(`  ⚠️ phone access · Bonjour advertisement failed (discovery only): ${e?.message || e}`));
    bonjour = b;
  } catch (e: any) {
    log(`  ⚠️ phone access · Bonjour unavailable (discovery only, still reachable by address): ${e?.message || e}`);
  }
}

/** Stop the listener and withdraw the Bonjour advertisement. Safe to call twice. */
export function stopLanListener(): void {
  const b = bonjour;
  bonjour = null;
  if (b) { try { b.unpublishAll(() => { try { b.destroy(); } catch { /* already gone */ } }); } catch { /* shutting down */ } }
  const s = server;
  server = null;
  info = null;
  if (s) { try { s.close(); s.closeAllConnections(); } catch { /* shutting down */ } }
}
