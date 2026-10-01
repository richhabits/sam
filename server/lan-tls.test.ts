import { createHash, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isTrustedLocal } from "./http-guards.ts";
import {
  certFingerprint, createLanGuard, type LanInfo, lanEnabled, lanInfo, lanPort, loadOrCreateLanCert,
  makeSelfSignedCert, pairNewLanFields, startLanListener, stopLanListener,
} from "./lan-tls.ts";
import { claimCode, mintPairingBundle, mintSession } from "./pairing.ts";
import { restartRefusal } from "./restart.ts";
import { lanIP, registerPeopleRoutes } from "./routes.people.ts";

// PHONE ACCESS (docs/decisions/0002). What must never regress: an unpaired device on the LAN
// reaches only /api/health and /api/pair/claim; a paired one reaches the API but never the
// loopback-only routes; nothing outside /api is served; and none of it exists unless SAM_LAN=1.

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `sam-test-${p}-`));
const made: string[] = [];
const quiet = (_s: string) => { /* keep test output clean */ };
const noHandler = () => { /* never called: nothing may listen */ };
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

describe("config", () => {
  it("is off unless SAM_LAN is exactly 1", () => {
    expect(lanEnabled({})).toBe(false);
    expect(lanEnabled({ SAM_LAN: "0" })).toBe(false);
    expect(lanEnabled({ SAM_LAN: "true" })).toBe(false);
    expect(lanEnabled({ SAM_LAN: "1" })).toBe(true);
  });
  it("defaults the port to 8788 and refuses junk", () => {
    expect(lanPort({})).toBe(8788);
    expect(lanPort({ SAM_LAN_PORT: "18788" })).toBe(18788);
    for (const bad of ["0", "65536", "80a", "-1", "1e3"]) expect(lanPort({ SAM_LAN_PORT: bad })).toBeNull();
  });
});

describe("the certificate", () => {
  it("is ECDSA P-256, CN SAM, SAN = LAN IP + localhost, ~10 years, self-signed", () => {
    const { certPem } = makeSelfSignedCert(["192.168.1.23"]);
    const c = new X509Certificate(certPem);
    expect(c.subject).toBe("CN=SAM");
    expect(c.issuer).toBe("CN=SAM");
    expect(c.subjectAltName).toBe("IP Address:192.168.1.23, DNS:localhost");
    expect(c.publicKey.asymmetricKeyType).toBe("ec");
    expect(c.publicKey.asymmetricKeyDetails?.namedCurve).toBe("prime256v1");
    expect(c.verify(c.publicKey)).toBe(true);
    expect(c.ca).toBe(false);
    const years = (Date.parse(c.validTo) - Date.now()) / (365.25 * 86400e3);
    expect(years).toBeGreaterThan(9.9);
    expect(years).toBeLessThan(10.1);
    expect(Date.parse(c.validFrom)).toBeLessThan(Date.now());
  });

  it("fingerprint is lowercase hex SHA-256 of the DER, no colons", () => {
    const { certPem } = makeSelfSignedCert(["10.0.0.5"]);
    const fp = certFingerprint(certPem);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).toBe(createHash("sha256").update(new X509Certificate(certPem).raw).digest("hex"));
    expect(fp).toBe(new X509Certificate(certPem).fingerprint256.replace(/:/g, "").toLowerCase());
  });

  it("is created once and reused — the fingerprint is what phones pin", () => {
    const dir = join(tmp("tls"), "tls");
    made.push(dirname(dir));
    const a = loadOrCreateLanCert("192.168.1.23", dir);
    const b = loadOrCreateLanCert("192.168.1.99", dir);   // a new LAN IP must NOT re-key
    expect(b.fingerprint).toBe(a.fingerprint);
    expect(readFileSync(join(dir, "cert.pem"), "utf8")).toBe(a.certPem);
  });

  it.skipIf(process.platform === "win32")("key and cert are mode 600, the dir 700", () => {
    const dir = join(tmp("tls"), "tls");
    made.push(dirname(dir));
    loadOrCreateLanCert("192.168.1.23", dir);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "key.pem")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "cert.pem")).mode & 0o777).toBe(0o600);
  });

  it("is regenerated only when missing or unreadable", () => {
    const dir = join(tmp("tls"), "tls");
    made.push(dirname(dir));
    const a = loadOrCreateLanCert("192.168.1.23", dir);
    writeFileSync(join(dir, "cert.pem"), "garbage");
    const b = loadOrCreateLanCert("192.168.1.23", dir);
    expect(b.fingerprint).not.toBe(a.fingerprint);
    rmSync(join(dir, "key.pem"));
    const c = loadOrCreateLanCert("192.168.1.23", dir);
    expect(c.fingerprint).not.toBe(b.fingerprint);
    // a key that doesn't match the cert is as unusable as a missing one
    writeFileSync(join(dir, "key.pem"), makeSelfSignedCert([]).keyPem);
    expect(loadOrCreateLanCert("192.168.1.23", dir).fingerprint).not.toBe(c.fingerprint);
  });
});

describe("/api/pair/new", () => {
  const LAN: LanInfo = { url: "https://192.168.1.23:8788", fingerprint: "ab".repeat(32) };
  it("adds lan + appLink only when phone access is on", () => {
    expect(pairNewLanFields("c0de", null)).toEqual({});
    expect(pairNewLanFields("c0de", LAN)).toEqual({
      lan: LAN,
      appLink: `sam://pair?code=c0de&host=https%3A%2F%2F192.168.1.23%3A8788&fp=${"ab".repeat(32)}`,
    });
  });
  it("is wired into the real handler, still behind isTrustedLocal", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
    const at = src.indexOf('app.post("/api/pair/new"');
    const handler = src.slice(at, src.indexOf("\napp.", at + 1));
    expect(handler).toContain("if (!isTrustedLocal(req))");
    expect(handler).toContain("...pairNewLanFields(bundle.code, lanInfo())");
  });
  it("the guard is the app's FIRST middleware", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
    const after = src.slice(src.indexOf("const app = express();"));
    expect(after.indexOf("app.use(")).toBe(after.indexOf("app.use(createLanGuard());"));
  });
});

// ── the listener, over real sockets ──────────────────────────
const IP = lanIP();
const PORT = 20000 + Math.floor(Math.random() * 20000);
// The listener's own certificate, trusted explicitly (like the phone's pin) so the client keeps
// full certificate validation on, hostname check against the SAN included.
let trustedCa: string | undefined;

function call(method: string, path: string, opts: { token?: string; body?: unknown; host?: string } = {}):
  Promise<{ status: number; body: any; fp: string }> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const r = httpsRequest({
      host: IP!, port: PORT, method, path, ca: trustedCa, agent: false,
      headers: {
        host: opts.host ?? `${IP}:${PORT}`,
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      const fp = createHash("sha256").update((res.socket as any).getPeerCertificate().raw).digest("hex");
      let s = "";
      res.on("data", (c) => { s += c; });
      res.on("end", () => { let body: any = s; try { body = JSON.parse(s); } catch { /* not json */ } resolve({ status: res.statusCode!, body, fp }); });
    });
    r.on("error", reject);
    r.end(data);
  });
}

describe.skipIf(!IP)("the LAN listener", () => {
  let info: LanInfo | null = null;
  let token = "";
  const tlsDir = join(tmp("lan"), "tls");
  made.push(dirname(tlsDir));

  beforeAll(async () => {
    // A cut-down copy of index.ts's stack: the guard first, then real handlers/guards.
    const app = express();
    app.use(createLanGuard());
    app.use(express.json());
    app.get("/api/health", (_req, res) => { res.json({ ok: true, uptime: 1, routing: ["secret"] }); });
    app.post("/api/pair/claim", (req, res) => {
      const t = claimCode(String(req.body?.code || ""), Date.now(), "test", req.socket.remoteAddress || "unknown");
      if (!t) { res.status(400).json({ error: "bad code" }); return; }
      res.json({ token: t });
    });
    app.get("/api/tools", (_req, res) => { res.json({ tools: [] }); });
    app.post("/api/pair/new", (req, res) => {
      if (!isTrustedLocal(req)) { res.status(403).json({ error: "pairing codes are minted from SAM on this machine only" }); return; }
      res.json({ code: "minted" });
    });
    app.post("/api/restart", (req, res) => {
      const refusal = restartRefusal({ trustedLocal: isTrustedLocal(req), supervised: true });
      if (refusal) { res.status(refusal.status).json({ error: refusal.error }); return; }
      res.json({ ok: true });
    });
    registerPeopleRoutes(app, 0, async () => { /* no rebind in tests */ });   // the real /api/mcp/configure
    app.get("/*splat", (_req, res) => { res.type("html").send("<html>HUD</html>"); });   // stands in for the static HUD

    info = await startLanListener(app, { ip: IP, env: { SAM_LAN: "1", SAM_LAN_PORT: String(PORT) }, bonjour: false, tlsDirPath: tlsDir, log: quiet });
    trustedCa = readFileSync(join(tlsDir, "cert.pem"), "utf8");
    token = mintSession(Date.now(), "test phone");
  });
  afterAll(() => stopLanListener());

  it("listens on the LAN address, never loopback", async () => {
    expect(info).toEqual({ url: `https://${IP}:${PORT}`, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(lanInfo()).toEqual(info);
    await expect(new Promise((ok, fail) => { const s = connect(PORT, "127.0.0.1"); s.on("connect", () => { s.destroy(); ok("open"); }); s.on("error", fail); }))
      .rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("serves the pinned certificate", async () => {
    const r = await call("GET", "/api/health");
    expect(r.fp).toBe(info!.fingerprint);
    expect(r.fp).toBe(certFingerprint(readFileSync(join(tlsDir, "cert.pem"), "utf8")));
  });

  it("health is open, but tells an unpaired device only that SAM is up", async () => {
    expect(await call("GET", "/api/health")).toMatchObject({ status: 200, body: { ok: true } });
    expect((await call("GET", "/api/health")).body.routing).toBeUndefined();
    expect((await call("GET", "/api/health", { token })).body.routing).toEqual(["secret"]);
  });

  it("every other route is 401 without a paired token", async () => {
    for (const [m, p] of [["GET", "/api/tools"], ["POST", "/api/pair/new"], ["POST", "/api/restart"], ["POST", "/api/mcp/configure"], ["GET", "/api/mcp/presets"], ["GET", "/api/health/"], ["GET", "/api/nope"]]) {
      expect(await call(m, p, { body: m === "POST" ? {} : undefined }), `${m} ${p}`).toMatchObject({ status: 401, body: { error: "pair this device first" } });
    }
    expect((await call("GET", "/api/tools", { token: "not-a-real-session" })).status).toBe(401);
  });

  it("a paired token gets through", async () => {
    expect(await call("GET", "/api/tools", { token })).toMatchObject({ status: 200, body: { tools: [] } });
  });

  it("loopback-only routes stay refused even with a valid token", async () => {
    expect((await call("POST", "/api/pair/new", { token, body: {} })).status).toBe(403);
    expect((await call("POST", "/api/restart", { token, body: {} })).status).toBe(403);
    expect((await call("POST", "/api/mcp/configure", { token, body: { id: "github", env: {} } })).status).toBe(403);
  });

  it("serves nothing outside /api — no HUD, no traversal", async () => {
    for (const p of ["/", "/index.html", "/pair?code=x", "/API/tools", "/api", "/api/../index.html", "/api/%2e%2e/index.html", "/api/..%2findex.html"]) {
      expect((await call("GET", p, { token })).status, p).toBe(404);
    }
  });

  it("claim works unauthenticated, and is rate-limited per IP", async () => {
    const { code } = mintPairingBundle(Date.now());
    const ok = await call("POST", "/api/pair/claim", { body: { code } });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.token).toBe("string");
    expect((await call("GET", "/api/tools", { token: ok.body.token })).status).toBe(200);
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await call("POST", "/api/pair/claim", { body: { code: "0" } })).status);
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s !== 429).length).toBeLessThanOrEqual(9);   // 10/min, one already spent
  });

  it("accepts its own Host, still rejects a domain-name Host", async () => {
    // hostAllowed lives in index.ts's stack, not this cut-down one — pin the helper directly.
    const { hostAllowed } = await import("./http-guards.ts");
    expect(hostAllowed(`${IP}:${PORT}`)).toBe(true);
    expect(hostAllowed(`${IP}:8788`)).toBe(true);
    expect(hostAllowed("evil.example:8788")).toBe(false);
  });
});

describe.skipIf(!IP)("with SAM_LAN unset", () => {
  it("nothing listens", async () => {
    const port = PORT + 1;
    const r = await startLanListener(noHandler, { ip: IP, env: { SAM_LAN_PORT: String(port) }, bonjour: false, log: quiet });
    expect(r).toBeNull();
    await expect(new Promise((ok, fail) => { const s = connect(port, IP!); s.on("connect", () => { s.destroy(); ok("open"); }); s.on("error", fail); }))
      .rejects.toMatchObject({ code: "ECONNREFUSED" });
  });
});

describe("refuses to widen", () => {
  it("never binds loopback or 0.0.0.0, and says why", async () => {
    for (const ip of [null, "127.0.0.1", "0.0.0.0", "::1", "not-an-ip"]) {
      const logs: string[] = [];
      expect(await startLanListener(noHandler, { ip, env: { SAM_LAN: "1", SAM_LAN_PORT: "1" }, bonjour: false, log: (s) => logs.push(s) })).toBeNull();
      expect(logs.join("")).toMatch(/phone access is off — SAM_LAN=1 but this Mac has no LAN address/);
    }
  });
});
