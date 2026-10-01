import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { aiProvidersReport } from "./ai-disclosure.ts";
import { getKey, setPool } from "./keys.ts";
import { PROVIDERS } from "./model-providers.ts";

const FAKE = { groq: "gsk_FAKEFAKEFAKEFAKEFAKEFAKEFAKE1", gemini: "AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE2", anthropic: "sk-ant-FAKEFAKEFAKEFAKEFAKE3" };
const sizes = (m: Record<string, number>) => (id: string) => m[id] ?? 0;

describe("aiProvidersReport", () => {
  it("has the documented shape", () => {
    const r = aiProvidersReport({ poolSize: sizes({ groq: 1 }), env: {}, gatewayUrl: "" });
    expect(Object.keys(r).sort()).toEqual(["cloud", "keyless", "onDevice", "updated"]);
    expect(typeof r.onDevice).toBe("boolean");
    expect(new Date(r.updated).toISOString()).toBe(r.updated);
    for (const p of [...r.cloud, ...r.keyless]) {
      expect(Object.keys(p).sort()).toEqual(["company", "free", "id", "name", "privacy"]);
      expect(p.privacy).toMatch(/^https:\/\//);
    }
    expect(r.cloud[0]).toEqual({ id: "groq", name: "Groq", company: "Groq, Inc.", privacy: "https://groq.com/privacy-policy/", free: true });
  });

  it("excludes providers without keys, and lists only the keyless lanes the router falls back to", () => {
    const r = aiProvidersReport({ poolSize: sizes({ groq: 2, openai: 1 }), env: {}, gatewayUrl: "" });
    expect(r.cloud.map((p) => p.id)).toEqual(["groq", "openai"]);
    expect(r.cloud.find((p) => p.id === "openai")?.free).toBe(false);
    expect(r.cloud.map((p) => p.id)).not.toContain("gemini");
    expect(r.keyless.map((p) => p.id)).toEqual(["pollinations"]);   // three lanes, one party
    expect(r.keyless.every((p) => p.free)).toBe(true);
  });

  it("does not list OpenRouter as keyless (the router needs a key for it) nor Hermes without its own key", () => {
    const r = aiProvidersReport({ poolSize: sizes({}), env: {}, gatewayUrl: "" });
    expect(r.cloud).toEqual([]);
    expect(r.keyless.map((p) => p.id)).toEqual(["pollinations"]);
    expect(aiProvidersReport({ poolSize: sizes({ hermes: 1 }), env: {}, gatewayUrl: "" }).cloud.map((p) => p.id)).toEqual(["hermes"]);
  });

  it("adds the SAM Cloud gateway as keyless only when configured and no cloud key is pooled", () => {
    expect(aiProvidersReport({ poolSize: sizes({}), env: {}, gatewayUrl: "https://gw.example" }).keyless.map((p) => p.id)).toContain("sam-cloud");
    expect(aiProvidersReport({ poolSize: sizes({ groq: 1 }), env: {}, gatewayUrl: "https://gw.example" }).keyless.map((p) => p.id)).not.toContain("sam-cloud");
  });

  it("onDevice is true only when DEFAULT_TIER=local AND no keyed cloud lane exists", () => {
    expect(aiProvidersReport({ poolSize: sizes({}), env: { DEFAULT_TIER: "local" }, gatewayUrl: "" }).onDevice).toBe(true);
    expect(aiProvidersReport({ poolSize: sizes({ groq: 1 }), env: { DEFAULT_TIER: "local" }, gatewayUrl: "" }).onDevice).toBe(false);
    expect(aiProvidersReport({ poolSize: sizes({}), env: {}, gatewayUrl: "" }).onDevice).toBe(false);
    expect(aiProvidersReport({ poolSize: sizes({}), env: { DEFAULT_TIER: "free" }, gatewayUrl: "" }).onDevice).toBe(false);
  });

  it("every provider that has a lane has a static entry (no unmapped fallbacks creeping in silently)", () => {
    const keyed = new Set(PROVIDERS.filter((p) => !p.noKey || p.id === "hermes").map((p) => p.id));
    const all = aiProvidersReport({ poolSize: (id) => (keyed.has(id) ? 1 : 0), env: {}, gatewayUrl: "" });
    expect(all.cloud.length).toBe(keyed.size);
    for (const p of all.cloud) expect(p.privacy).toMatch(/^https:\/\//);
  });

  it("never leaks key values, key counts or env values, using the REAL key pools", () => {
    for (const [id, k] of Object.entries(FAKE)) setPool(id, [k, `${k}-second`]);
    try {
      expect(getKey("groq")).toBeTruthy();   // the pool really holds the fake key
      const json = JSON.stringify(aiProvidersReport({ env: { DEFAULT_TIER: "free", GROQ_API_KEY: FAKE.groq, SECRET_X: "hunter2-secret" }, gatewayUrl: "https://gw-secret.example" }));
      for (const k of Object.values(FAKE)) { expect(json).not.toContain(k); expect(json).not.toContain(k.slice(0, 12)); }
      expect(json).not.toContain("hunter2");
      expect(json).not.toContain("gw-secret");
      expect(json).not.toMatch(/gsk_|AIza|sk-ant/);
      expect(json).not.toMatch(/"(keys|count|size|total|uses)"/);
      const ids = aiProvidersReport().cloud.map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining(["groq", "gemini", "anthropic"]));
    } finally {
      for (const id of Object.keys(FAKE)) setPool(id, []);
    }
  });
});

describe("GET /api/ai/providers is guarded at the route", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
  it("requires loopback-trusted or a paired session, and answers from aiProvidersReport()", () => {
    const m = src.match(/app\.get\("\/api\/ai\/providers",[^\n]*\n([^\n]*)\n([^\n]*)/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("canReadPrivate(req)");
    expect(m![2]).toContain("aiProvidersReport()");
  });
});
