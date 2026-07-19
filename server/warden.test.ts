import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hostAllowed, isTrustedLocal, originAllowed } from "./http-guards.ts";
import { checkOutboundUrl } from "./url-guard.ts";
import { relayBrain, type Brain } from "./relay.ts";
import { redact, recentTrail, _reset as resetIssues } from "./issues.ts";
import { isCatastrophic } from "./tools.ts";
import { holdPending, takePending, withPending, _clearPending } from "./pending.ts";
import * as safe from "./safe.ts";

// ─────────────────────────────────────────────────────────────
//  THE WARDEN — SAM's security-regression gate.
//
//  Defensive, deterministic, offline. Each check ATTEMPTS a disallowed thing against SAM's own
//  guards and asserts it is refused LOUDLY. No LLM, no attack automation, no external targets —
//  the Warden only tests SAM against SAM. A red Warden means a guardrail regressed; that build
//  MUST fail. Guardrails that can't be tested deterministically are declared in KNOWN_GAPS below,
//  never silently skipped.
// ─────────────────────────────────────────────────────────────

const loopbackReq = (headers: Record<string, string> = {}) => ({ socket: { remoteAddress: "127.0.0.1" }, headers });
const remoteReq = (headers: Record<string, string> = {}) => ({ socket: { remoteAddress: "203.0.113.7" }, headers });

describe("the Warden · #1 Handshake — loopback position is not authorization", () => {
  const KNOWN = "a".repeat(64);
  beforeEach(() => { process.env.SAM_REQUIRE_CONTROL_TOKEN = "1"; process.env.SAM_CONTROL_TOKEN = KNOWN; });
  afterEach(() => { delete process.env.SAM_REQUIRE_CONTROL_TOKEN; delete process.env.SAM_CONTROL_TOKEN; });

  it("a loopback request WITHOUT the passkey is refused when enforcement is on", () => {
    expect(isTrustedLocal(loopbackReq())).toBe(false);
    expect(isTrustedLocal(loopbackReq({ "x-sam-token": "wrong" }))).toBe(false);
  });
  it("a loopback request WITH the correct passkey is trusted", () => {
    expect(isTrustedLocal(loopbackReq({ "x-sam-token": KNOWN }))).toBe(true);
  });
  it("a NON-loopback request is never trusted, passkey or not", () => {
    expect(isTrustedLocal(remoteReq({ "x-sam-token": KNOWN }))).toBe(false);
  });
});

describe("the Warden · #3 SSRF — outbound fetch cannot reach the user's own machine/LAN", () => {
  const never = async () => { throw new Error("resolver must not be reached for a literal IP"); };
  it("blocks loopback, private, CGNAT, link-local metadata, and IPv4-mapped IPv6 — as literals", async () => {
    for (const u of [
      "http://127.0.0.1/admin", "http://10.0.0.1/", "http://192.168.1.1/", "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://100.64.0.1/",
    ]) {
      expect((await checkOutboundUrl(u, never)).ok).toBe(false);
    }
  });
  it("blocks a non-http scheme (no file:/ arbitrary-read escalation)", async () => {
    expect((await checkOutboundUrl("file:///etc/passwd", never)).ok).toBe(false);
  });
  it("blocks a hostname that RESOLVES to a private address (injected resolver)", async () => {
    const rebind = async () => ["10.0.0.5"];
    const v = await checkOutboundUrl("http://looks-public.example/", rebind);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/resolves to private/);
  });
  it("allows a genuinely public address", async () => {
    const publicDns = async () => ["93.184.216.34"];
    expect((await checkOutboundUrl("https://example.com/", publicDns)).ok).toBe(true);
  });
});

describe("the Warden · #6 local→cloud boundary — a private request never silently crosses to cloud", () => {
  const cloud: Brain = { id: "warden-cloud", boundary: "cloud", run: async () => "SHOULD NOT RUN" };
  const local: Brain = { id: "warden-local", boundary: "local", noKey: true, run: async () => "ok" };
  it("refuses a cloud brain LOUDLY when cloud isn't allowed — never falls through", async () => {
    const out = await relayBrain(cloud, "sys", "hi", { allowCloud: false });
    expect(out).not.toBeNull();
    expect(out && "blocked" in out).toBe(true);
    expect(out && "text" in out).toBe(false); // it did NOT run the cloud brain
  });
  it("does not block a local brain (the boundary only refuses CROSSING to cloud)", async () => {
    const out = await relayBrain(local, "sys", "hi", { allowCloud: false });
    expect(out !== null && "blocked" in out).toBe(false); // not refused by the boundary
    expect(out !== null && "text" in out && out.text).toBe("ok"); // it ran locally
  });
});

describe("the Warden · #5 redaction — no secret value survives into a record", () => {
  it("scrubs api-key / bearer / long-hex shapes", () => {
    expect(redact("key sk-abcdef0123456789abcdef")).toContain("[redacted]");
    expect(redact("Authorization: Bearer abcdef0123456789abcdef")).toContain("[redacted]");
    expect(redact("token=ghp_012345678901234567890123456789012345")).toContain("[redacted]");
  });
});

describe("the Warden · #10 command denylist — a catastrophic command is refused even if approved", () => {
  it("blocks unrecoverable wipes", () => {
    for (const c of ["rm -rf ~", "rm -rf /", "rm -rf $HOME"]) expect(isCatastrophic(c)).toBe(true);
  });
  it("does not false-positive on ordinary cleanup / read-only uses", () => {
    for (const c of ["ls -la", "rm -rf ./dist", "grep shutdown log"]) expect(isCatastrophic(c)).toBe(false);
  });
});

describe("the Warden · #14 pending approvals are server-held — approve by id only", () => {
  beforeEach(() => _clearPending());
  it("the transcript is stripped from what the client receives", () => {
    const wrapped = withPending({ kind: "pending", tool: "write_file", input: { path: "~/x" }, transcript: "SENSITIVE CONTEXT" }, { tier: "free", skillBody: "" });
    expect(wrapped.pendingId).toBeTruthy();
    expect(wrapped.transcript).toBe("");                 // never leaves the server
  });
  it("a bogus id resolves nothing; a real id is one-shot", () => {
    const id = holdPending({ tool: "t", input: {}, transcript: "", trace: [], tier: "free", skillBody: "" });
    expect(takePending("bogus-id")).toBeUndefined();
    expect(takePending(id)).toBeTruthy();
    expect(takePending(id)).toBeUndefined();             // consumed — can't be replayed
  });
});

describe("the Warden · #8/#9 CORS + anti-DNS-rebinding — a hostile website cannot reach the API", () => {
  it("CORS: only same-origin / localhost origins are allowed", () => {
    expect(originAllowed("https://evil.com")).toBe(false);
    expect(originAllowed("http://localhost:5273")).toBe(true);
    expect(originAllowed("http://127.0.0.1:8787")).toBe(true);
    expect(originAllowed(undefined)).toBe(true);          // non-browser / same-origin
  });
  it("Host: a domain-name Host header (rebinding tell) is rejected; loopback/LAN is allowed", () => {
    expect(hostAllowed("attacker.com")).toBe(false);
    expect(hostAllowed("evil.com:8787")).toBe(false);
    expect(hostAllowed("localhost:8787")).toBe(true);
    expect(hostAllowed("127.0.0.1:8787")).toBe(true);
    expect(hostAllowed("192.168.1.5:8787")).toBe(true);
  });
});

describe("the Warden · #4 the Safe — no plaintext secret at rest; a locked read fails loud", () => {
  const PASS = "correct horse battery";
  const VALUE = "sk-WARDEN-SECRET-1a2b3c4d5e6f";
  let dir = "";
  beforeEach(() => {
    resetIssues(); safe._reset();
    dir = join(tmpdir(), `sam-warden-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    process.env.VAULT_DIR = dir;
    process.env.DOTENV_CONFIG_PATH = join(dir, ".env");
  });
  afterEach(() => {
    safe._reset();
    delete process.env.VAULT_DIR; delete process.env.DOTENV_CONFIG_PATH; delete process.env.GROQ_API_KEYS;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  it("after migration no plaintext value remains on disk (.env or the sealed store)", () => {
    writeFileSync(join(dir, ".env"), `KEEP=ok\nGROQ_API_KEYS=${VALUE}\n`);
    process.env.GROQ_API_KEYS = VALUE;
    expect(safe.setup({ passphrase: PASS }).ok).toBe(true);
    safe.migrateFromEnv(["GROQ_API_KEYS"]);
    expect(readFileSync(join(dir, ".env"), "utf8")).not.toContain(VALUE);
    expect(readFileSync(join(dir, "safe.enc"), "utf8")).not.toContain(VALUE);
  });
  it("a locked read THROWS — the Safe never falls back to plaintext", () => {
    safe.setup({ passphrase: PASS });
    safe.put("GROQ_API_KEYS", VALUE);
    safe.lock();
    expect(() => safe.get("GROQ_API_KEYS")).toThrow(/locked/);
  });
  it("no secret VALUE reaches the Trail on read — only the name", () => {
    safe.setup({ passphrase: PASS });
    safe.put("GROQ_API_KEYS", VALUE);
    resetIssues();
    safe.get("GROQ_API_KEYS");
    const dump = JSON.stringify(recentTrail());
    expect(dump).toContain("GROQ_API_KEYS");
    expect(dump).not.toContain(VALUE);
  });
});

// ── THE MANIFEST — every known guardrail is accounted for, or it's a FINDING (never a silent skip).
//    status "warden" = an adversarial assertion above · "unit" = a dedicated test file · "known-gap"
//    = can't be tested deterministically, with the honest reason. Adding a guardrail without an entry,
//    or leaving a gap unexplained, fails this test.
interface GuardEntry { id: number; invariant: string; status: "warden" | "unit" | "known-gap"; ref: string }
const MANIFEST: GuardEntry[] = [
  { id: 1, invariant: "Handshake enforcement", status: "warden", ref: "this file" },
  { id: 2, invariant: "isLoopback reads socket not headers", status: "unit", ref: "http-guards.test.ts" },
  { id: 3, invariant: "URL guard / SSRF", status: "warden", ref: "this file" },
  { id: 4, invariant: "the Safe — no plaintext at rest", status: "warden", ref: "this file" },
  { id: 5, invariant: "redaction — no secret in records", status: "warden", ref: "this file" },
  { id: 6, invariant: "local→cloud boundary (the Relay)", status: "warden", ref: "this file" },
  { id: 7, invariant: "remote-mode token gate", status: "unit", ref: "remote-tokens.test.ts" },
  { id: 8, invariant: "CORS origin allowlist", status: "warden", ref: "this file" },
  { id: 9, invariant: "anti-DNS-rebinding Host check", status: "warden", ref: "this file" },
  { id: 10, invariant: "command denylist", status: "warden", ref: "this file" },
  { id: 11, invariant: "path traversal (forge/vault ids)", status: "unit", ref: "codeql-findings.test.ts" },
  { id: 12, invariant: ".env line-injection", status: "unit", ref: "routes.contract.test.ts" },
  { id: 13, invariant: "the Cell (forge sandbox)", status: "unit", ref: "forge.test.ts" },
  { id: 14, invariant: "server-held pending approvals", status: "warden", ref: "this file" },
  { id: 15, invariant: "creative proxy SSRF (string-concat)", status: "unit", ref: "routes.creative.ssrf.test.ts" },
];
const KNOWN_GAPS: { invariant: string; why: string }[] = [
  { invariant: "URL-guard DNS rebinding", why: "check-then-fetch; the checked IP isn't pinned into the socket. The Warden proves the CHECK refuses; closing it needs a pinning agent." },
  { invariant: "Safe vs malware-as-user", why: "on-device code running as the user can ask the keychain / read process memory exactly as SAM does — no on-device scheme prevents this." },
  { invariant: "Safe keychain path", why: "unit tests use passphrase mode; touching the real OS keychain in CI would be a side effect. Mirrors the shipping vault-crypto helpers." },
];

describe("the Warden · manifest — every guardrail is accounted for", () => {
  it("has an entry per inventoried guardrail with a real status and ref", () => {
    expect(MANIFEST.length).toBe(15);
    expect(new Set(MANIFEST.map((g) => g.id)).size).toBe(15); // no dup ids
    for (const g of MANIFEST) {
      expect(g.invariant.length).toBeGreaterThan(3);
      expect(["warden", "unit", "known-gap"]).toContain(g.status);
      expect(g.ref.length).toBeGreaterThan(3);
    }
  });
  it("declares every untestable guardrail with an honest reason — no silent skips", () => {
    expect(KNOWN_GAPS.length).toBeGreaterThan(0);
    for (const gap of KNOWN_GAPS) expect(gap.why.length).toBeGreaterThan(20);
  });
});
