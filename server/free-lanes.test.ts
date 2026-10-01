// Free-lane autopilot: ledger, quota gate, Retry-After cooldowns, failover order, model discovery
// and the status endpoint's no-secrets rule. NO network: every provider response is a recorded
// fixture served by a fetch mock, and no completion endpoint is ever called.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { laneGrade, type LaneSignals, lanesStatus, quotaOrder } from "./free-lanes.ts";
import { FREE_QUOTAS } from "./free-quotas.ts";
import { getKey, laneAvailability, reloadPools, reportFailure, setPool } from "./keys.ts";
import { _resetDiscovery, applyCachedOverrides, catalogueFile, discoverModels, pickReplacement } from "./model-discovery.ts";
import { configuredModel, httpError, laneModel, parseDurationMs, PROVIDERS, retryAfterMs, setLaneModel } from "./model-providers.ts";
import { _resetBreakers, relayBrain } from "./relay.ts";
import { _reset as resetHealth } from "./speed.ts";
import { _resetLedger, flushLedger, ledgerFile, ledgerSnapshot, nearQuota, recordLaneCall, slotId, successRate, usedToday } from "./usage-ledger.ts";

// Secret-looking values are generated at runtime, never written as literals (CI runs gitleaks).
const fakeKey = (prefix: string) => `${prefix}${randomBytes(18).toString("hex")}`;

let dir = "";
let prevVault: string | undefined;
beforeEach(() => {
  prevVault = process.env.VAULT_DIR;
  dir = mkdtempSync(join(tmpdir(), "sam-test-lanes-"));
  process.env.VAULT_DIR = dir;
  _resetLedger();
  _resetDiscovery();
  _resetBreakers();
  resetHealth();
});
afterEach(() => {
  vi.useRealTimers();
  for (const id of ["groq", "openrouter", "cerebras", "gemini", "mistral", "nvidia"]) setLaneModel(id, null);
  _resetLedger();
  _resetDiscovery();
  process.env.VAULT_DIR = prevVault;
  reloadPools();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// Pin the clock mid-minute so minute windows can't roll over during a test.
const pinClock = () => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-01T12:00:20Z")); };

describe("usage ledger", () => {
  it("accounts requests, tokens, 429s and errors per slot, in day and minute windows", () => {
    pinClock();
    const s = slotId(fakeKey("gsk_"));
    recordLaneCall("groq", s, { ok: true, tokensIn: 100, tokensOut: 40 });
    recordLaneCall("groq", s, { ok: true, tokensIn: 50, tokensOut: 10 });
    recordLaneCall("groq", s, { ok: false, status: 429 });
    recordLaneCall("groq", s, { ok: false, status: 500, tokensIn: 30 });
    const u = ledgerSnapshot().providers.groq.slots[s];
    expect(u).toMatchObject({ requests: 3, tokensIn: 180, tokensOut: 50, rateLimited: 1, errors: 1, dayRequests: 3, minuteRequests: 3, dayTokens: 230, day: "2026-10-01" });
    expect(usedToday("groq")).toBe(3);
    expect(successRate("groq")).toBe(0.5);
    // A new minute resets the minute window, not the day.
    vi.setSystemTime(new Date("2026-10-01T12:01:20Z"));
    recordLaneCall("groq", s, { ok: true, tokensIn: 1, tokensOut: 1 });
    const v = ledgerSnapshot().providers.groq.slots[s];
    expect(v.minuteRequests).toBe(1);
    expect(v.dayRequests).toBe(4);
    // A new UTC day resets the day window.
    vi.setSystemTime(new Date("2026-10-02T00:00:05Z"));
    expect(usedToday("groq")).toBe(0);
  });

  it("persists atomically to usage-ledger.json with 0600 and never stores the key", () => {
    const key = fakeKey("gsk_");
    recordLaneCall("groq", slotId(key), { ok: true, tokensIn: 10, tokensOut: 5 });
    flushLedger();
    const file = ledgerFile();
    expect(file).toBe(join(dir, "usage-ledger.json"));
    const raw = readFileSync(file, "utf8");
    expect(raw).not.toContain(key);
    expect(raw).toContain(slotId(key));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    _resetLedger();   // forget memory → must come back from disk
    expect(ledgerSnapshot().providers.groq.slots[slotId(key)].requests).toBe(1);
  });

  it("slot ids are short, stable and not the key", () => {
    const key = fakeKey("sk-or-");
    expect(slotId(key)).toMatch(/^[0-9a-f]{8}$/);
    expect(slotId(key)).toBe(slotId(key));
    expect(key).not.toContain(slotId(key));
    expect(slotId("")).toBe("nokey");
  });
});

describe("proactive skip at 90% of a documented free quota", () => {
  it("rotates off a key at 90% of RPM, and returns no key once every slot is there", () => {
    pinClock();
    const a = fakeKey("sk-or-"), b = fakeKey("sk-or-");
    setPool("openrouter", [a, b]);
    const rpm = FREE_QUOTAS.openrouter.rpm as number;   // 20 → skip from 18
    for (let i = 0; i < Math.floor(rpm * 0.9); i++) recordLaneCall("openrouter", slotId(a), { ok: true, tokensIn: 1, tokensOut: 1 });
    expect(nearQuota("openrouter", slotId(a))).toBe(true);
    expect(nearQuota("openrouter", slotId(b))).toBe(false);
    for (let i = 0; i < 4; i++) expect(getKey("openrouter")).toBe(b);
    for (let i = 0; i < Math.floor(rpm * 0.9); i++) recordLaneCall("openrouter", slotId(b), { ok: true, tokensIn: 1, tokensOut: 1 });
    expect(getKey("openrouter")).toBeNull();
    const av = laneAvailability("openrouter");
    expect(av.usable).toBe(false);
    expect(av.coolingUntil).toBe(Date.parse("2026-10-01T12:01:00Z"));   // the next minute
    // The minute rolls → usable again.
    vi.setSystemTime(new Date("2026-10-01T12:01:01Z"));
    expect(getKey("openrouter")).not.toBeNull();
  });

  it("a day-quota gate frees at the next UTC midnight", () => {
    pinClock();
    const a = fakeKey("sk-or-");
    setPool("openrouter", [a]);
    // 45 of 50 RPD spread over earlier minutes so only the DAY window is full.
    vi.setSystemTime(new Date("2026-10-01T08:00:00Z"));
    for (let i = 0; i < 15; i++) recordLaneCall("openrouter", slotId(a), { ok: true });
    vi.setSystemTime(new Date("2026-10-01T09:00:00Z"));
    for (let i = 0; i < 15; i++) recordLaneCall("openrouter", slotId(a), { ok: true });
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
    for (let i = 0; i < 15; i++) recordLaneCall("openrouter", slotId(a), { ok: true });
    vi.setSystemTime(new Date("2026-10-01T12:00:20Z"));
    expect(getKey("openrouter")).toBeNull();
    expect(laneAvailability("openrouter").coolingUntil).toBe(Date.parse("2026-10-02T00:00:00Z"));
  });

  it("never gates a lane whose provider publishes no limit", () => {
    const k = fakeKey("AIza");
    setPool("gemini", [k]);
    for (let i = 0; i < 500; i++) recordLaneCall("gemini", slotId(k), { ok: true, tokensIn: 1000 });
    expect(getKey("gemini")).toBe(k);
  });
});

describe("429 + Retry-After sets coolingUntil precisely", () => {
  it("parses retry-after seconds, HTTP dates, x-ratelimit-reset-* and Gemini retryDelay", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(retryAfterMs(new Headers({ "retry-after": "7" }))).toBe(7000);
    expect(retryAfterMs(new Headers({ "retry-after": "Thu, 01 Oct 2026 12:00:30 GMT" }), "", now)).toBe(30_000);
    expect(retryAfterMs(new Headers({ "x-ratelimit-remaining-requests": "0", "x-ratelimit-reset-requests": "2m59.56s", "x-ratelimit-remaining-tokens": "12", "x-ratelimit-reset-tokens": "7.66s" }))).toBe(179_560);
    expect(retryAfterMs(new Headers(), '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"37s"}]}}')).toBe(37_000);
    expect(retryAfterMs(new Headers())).toBeUndefined();
    expect(parseDurationMs("1h2m3s")).toBe(3_723_000);
    expect(parseDurationMs("20ms")).toBe(20);
  });

  it("httpError carries retryAfterMs on a 429", async () => {
    const e = await httpError("http", new Response("{}", { status: 429, headers: { "retry-after": "12" } }));
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(12_000);
  });

  it("KeyPool honours it exactly (not the flat 60s fallback)", () => {
    pinClock();
    const k = fakeKey("gsk_");
    setPool("groq", [k]);
    reportFailure("groq", k, 429, 7000);
    expect(laneAvailability("groq").coolingUntil).toBe(Date.now() + 7000);
    setPool("groq", [k]);
    reportFailure("groq", k, 429);   // no header → the old flat minute
    expect(laneAvailability("groq").coolingUntil).toBe(Date.now() + 60_000);
  });

  it("through the Relay: a 429 response's Retry-After becomes the key's cooldown and is ledgered", async () => {
    pinClock();
    const k = fakeKey("gsk_");
    setPool("groq", [k]);
    const r = await relayBrain({ id: "groq", boundary: "cloud", run: async () => { throw await httpError("http", new Response("", { status: 429, headers: { "retry-after": "42" } })); } }, "sys", "hi", { allowCloud: true });
    expect(r.ok).toBe(false);
    expect(laneAvailability("groq").coolingUntil).toBe(Date.now() + 42_000);
    expect(ledgerSnapshot().providers.groq.slots[slotId(k)].rateLimited).toBe(1);
  });

  it("a successful Relay call is ledgered with estimated tokens", async () => {
    const k = fakeKey("gsk_");
    setPool("groq", [k]);
    const r = await relayBrain({ id: "groq", boundary: "cloud", run: async () => "a short answer" }, "system prompt", "user prompt", { allowCloud: true });
    expect(r.ok).toBe(true);
    const u = ledgerSnapshot().providers.groq.slots[slotId(k)];
    expect(u.requests).toBe(1);
    expect(u.tokensIn).toBeGreaterThan(0);
    expect(u.tokensOut).toBeGreaterThan(0);
  });
});

describe("failover ordering", () => {
  const sig = (o: Partial<LaneSignals>): LaneSignals => ({ usable: true, coolingUntil: 0, headroom: 1, successRate: null, breakerOpen: false, ...o });

  it("grades lanes: usable → demoted (flaky / nearly spent) → cannot answer now", () => {
    expect(laneGrade(sig({}))).toBe(0);
    expect(laneGrade(sig({ successRate: 0.3 }))).toBe(1);
    expect(laneGrade(sig({ headroom: 0.1 }))).toBe(1);
    expect(laneGrade(sig({ usable: false }))).toBe(2);
    expect(laneGrade(sig({ breakerOpen: true }))).toBe(2);
  });

  it("puts the healthiest lanes first and keeps upstream order within a grade", () => {
    const pool = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const s: Record<string, LaneSignals> = {
      a: sig({ usable: false, coolingUntil: Date.now() + 1000 }),
      b: sig({ successRate: 0.2 }),
      c: sig({}),
      d: sig({ headroom: 0.05 }),
      e: sig({}),
    };
    expect(quotaOrder(pool, (p) => s[p.id]).map((p) => p.id)).toEqual(["c", "e", "b", "d", "a"]);
  });

  it("with real pools: a lane whose only key is rate-limited is tried after the ones that can answer", () => {
    const g = fakeKey("gsk_"), c = fakeKey("csk-");
    setPool("groq", [g]);
    setPool("cerebras", [c]);
    reportFailure("groq", g, 429, 30_000);
    const pool = PROVIDERS.filter((p) => p.id === "groq" || p.id === "cerebras");
    const ordered = quotaOrder([pool.find((p) => p.id === "groq")!, pool.find((p) => p.id === "cerebras")!]);
    expect(ordered.map((p) => p.id)).toEqual(["cerebras", "groq"]);
  });

  it("never introduces a paid lane: quotaOrder only reorders what it is given", () => {
    const free = PROVIDERS.filter((p) => p.tier === "free");
    const out = quotaOrder(free);
    expect(out.length).toBe(free.length);
    expect(out.every((p) => p.tier === "free")).toBe(true);
  });
});

// ── Recorded list-endpoint fixtures (trimmed to the fields discovery reads) ──
const OPENROUTER_FIXTURE = {
  data: [
    { id: "nvidia/nemotron-3-ultra-550b:free", pricing: { prompt: "0", completion: "0", request: "0" }, architecture: { output_modalities: ["text"] } },
    { id: "openai/gpt-oss-120b:free", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["text"] } },
    { id: "openai/gpt-oss-120b", pricing: { prompt: "0.0000001", completion: "0.0000005" }, architecture: { output_modalities: ["text"] } },
    { id: "anthropic/claude-sonnet-5", pricing: { prompt: "0.000003", completion: "0.000015" }, architecture: { output_modalities: ["text"] } },
    { id: "sneaky/paid-but-named:free", pricing: { prompt: "0.000001", completion: "0" }, architecture: { output_modalities: ["text"] } },
    { id: "google/some-image-model:free", pricing: { prompt: "0", completion: "0" }, architecture: { output_modalities: ["image"] } },
  ],
};
const groqFixture = () => ({
  object: "list",
  data: [
    { id: configuredModel("groq"), active: true },
    { id: "whisper-large-v3", active: true },
    { id: "meta-llama/llama-prompt-guard-2-86m", active: true },
    { id: "qwen/qwen3-32b", active: true },
  ],
});
const GEMINI_FIXTURE = {
  models: [
    { name: "models/gemini-3.0-flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
    { name: "models/gemini-3.0-pro", supportedGenerationMethods: ["generateContent"] },
    { name: "models/gemini-3.0-flash-image", supportedGenerationMethods: ["generateContent"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
  ],
};

function fixtureFetch(calls: string[]) {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.startsWith("https://openrouter.ai/api/v1/models")) return new Response(JSON.stringify(OPENROUTER_FIXTURE), { status: 200 });
    if (u.startsWith("https://api.groq.com/openai/v1/models")) return new Response(JSON.stringify(groqFixture()), { status: 200 });
    if (u.startsWith("https://generativelanguage.googleapis.com/v1beta/models")) return new Response(JSON.stringify(GEMINI_FIXTURE), { status: 200 });
    if (u.startsWith("https://api.cerebras.ai/v1/models")) return new Response("{}", { status: 500 });
    throw new Error(`unexpected fetch in test: ${u}`);
  }) as typeof fetch;
}

describe("model auto-discovery (fixtures only — list endpoints, never completions)", () => {
  const keys: Record<string, string> = {};
  beforeEach(() => {
    keys.openrouter = fakeKey("sk-or-"); keys.groq = fakeKey("gsk_"); keys.gemini = fakeKey("AIza"); keys.cerebras = fakeKey("csk-");
  });

  it("replaces a retired default, keeps a still-listed one, filters out paid models", async () => {
    const calls: string[] = [];
    const logs: string[] = [];
    const res = await discoverModels({ fetch: fixtureFetch(calls), key: (id) => keys[id] ?? null, now: () => new Date("2026-10-01T03:00:00Z"), log: (m) => logs.push(m) });

    // Only list endpoints, never a completion.
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((u) => /\/models(\?|$)/.test(u))).toBe(true);
    expect(calls.some((u) => u.includes("completions") || u.includes("generateContent"))).toBe(false);
    // No key in any URL (gemini's goes in a header).
    for (const k of Object.values(keys)) expect(calls.join(" ")).not.toContain(k);

    // OpenRouter: configured slug is absent from the live list → replaced by the best FREE model.
    const or = res.openrouter as { models: string[]; replaced: boolean; active: string };
    expect(or.models).toEqual(["nvidia/nemotron-3-ultra-550b:free", "openai/gpt-oss-120b:free"]);
    expect(or.models).not.toContain("anthropic/claude-sonnet-5");
    expect(or.models).not.toContain("sneaky/paid-but-named:free");
    expect(or.models).not.toContain("google/some-image-model:free");
    expect(or.replaced).toBe(true);
    expect(laneModel("openrouter")).toBe("openai/gpt-oss-120b:free");   // preference list beats list order
    expect(PROVIDERS.find((p) => p.id === "openrouter")?.label).toBe("openrouter:openai/gpt-oss-120b:free");
    expect(logs.join("\n")).toContain("no longer listed");

    // Groq: configured model is still listed → untouched; non-chat models filtered.
    const gq = res.groq as { models: string[]; replaced: boolean };
    expect(gq.replaced).toBe(false);
    expect(laneModel("groq")).toBe(configuredModel("groq"));
    expect(gq.models).not.toContain("whisper-large-v3");
    expect(gq.models.some((m) => m.includes("guard"))).toBe(false);

    // Gemini: retired 2.5-flash → the Flash replacement; Pro and image models are never chosen.
    const gm = res.gemini as { models: string[]; active: string };
    expect(gm.models).toEqual(["gemini-3.0-flash"]);
    expect(laneModel("gemini")).toBe("gemini-3.0-flash");

    // A failed list proves nothing: cerebras keeps its configured model.
    expect(res.cerebras).toEqual({ error: "http 500" });
    expect(laneModel("cerebras")).toBe(configuredModel("cerebras"));

    // Cached in the vault, 0600, no keys inside.
    const raw = readFileSync(catalogueFile(), "utf8");
    expect(statSync(catalogueFile()).mode & 0o777).toBe(0o600);
    for (const k of Object.values(keys)) expect(raw).not.toContain(k);
    expect(JSON.parse(raw).providers.openrouter.discoveredAt).toBe("2026-10-01T03:00:00.000Z");
  });

  it("skips providers with no key at all (nothing to discover for an unused lane)", async () => {
    const calls: string[] = [];
    await discoverModels({ fetch: fixtureFetch(calls), key: () => null, log: () => {/* quiet in tests */} });
    expect(calls).toEqual([]);
  });

  it("re-applies a cached replacement at boot only while the configuration is unchanged", async () => {
    await discoverModels({ fetch: fixtureFetch([]), key: (id) => keys[id] ?? null, log: () => {/* quiet in tests */} });
    setLaneModel("openrouter", null);
    _resetDiscovery();
    applyCachedOverrides();
    expect(laneModel("openrouter")).toBe("openai/gpt-oss-120b:free");   // preference list beats list order
  });

  it("pickReplacement follows the preference list, then the first listed", () => {
    expect(pickReplacement(["x", "y-gpt-oss-120b"], [/gpt-oss-120b/])).toBe("y-gpt-oss-120b");
    expect(pickReplacement(["x", "y"], [/nope/])).toBe("x");
    expect(pickReplacement([], [/nope/])).toBeNull();
  });
});

describe("GET /api/lanes/status payload", () => {
  it("has the documented per-lane shape and carries no key values, slot ids or key counts", async () => {
    const seeded = { groq: [fakeKey("gsk_"), fakeKey("gsk_"), fakeKey("gsk_")], openrouter: [fakeKey("sk-or-")], gemini: [fakeKey("AIza"), fakeKey("AIza")] };
    for (const [id, ks] of Object.entries(seeded)) setPool(id, ks);
    for (const k of seeded.groq) recordLaneCall("groq", slotId(k), { ok: true, tokensIn: 10, tokensOut: 10 });
    reportFailure("openrouter", seeded.openrouter[0], 429, 5000);

    const lanes = lanesStatus();
    const json = JSON.stringify(lanes);
    for (const k of Object.values(seeded).flat()) {
      expect(json).not.toContain(k);
      expect(json).not.toContain(slotId(k));
    }
    expect(json).not.toMatch(/"(keys|total|slots?|cooling|healthyKeys)"/);
    for (const l of lanes) {
      expect(Object.keys(l).sort()).toEqual(["coolingUntil", "discoveredAt", "healthy", "id", "limitPerDay", "model", "name", "usedToday"]);
    }
    const groq = lanes.find((l) => l.id === "groq");
    expect(groq).toMatchObject({ name: "Groq", healthy: true, usedToday: 3, limitPerDay: FREE_QUOTAS.groq.rpd, model: configuredModel("groq") });
    const or = lanes.find((l) => l.id === "openrouter");
    expect(or?.healthy).toBe(false);
    expect(or?.coolingUntil).toBeGreaterThan(Date.now());
    // Keyless lanes are listed; paid lanes never are.
    expect(lanes.some((l) => l.id.startsWith("pollinations"))).toBe(true);
    expect(lanes.some((l) => l.id === "anthropic" || l.id === "openai")).toBe(false);
  });

  it("the route is registered behind the same guard as /api/ai/providers", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
    const at = src.indexOf('app.get("/api/lanes/status"');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 200)).toContain("canReadPrivate(req)");
  });
});
