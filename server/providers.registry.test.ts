import { describe, it, expect } from "vitest";
import { PROVIDER_REGISTRY, POOLED, PROVIDER_ENV, CONFIG_STYLE, uiCatalogue } from "./providers.registry.ts";

describe("PROVIDER_REGISTRY structural integrity", () => {
  it("every provider has a unique id", () => {
    const ids = PROVIDER_REGISTRY.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every provider has required fields", () => {
    for (const p of PROVIDER_REGISTRY) {
      expect(p.id).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(["free", "premium"]).toContain(p.tier);
      expect(p.note).toBeTruthy();
      expect(p.url).toContain("http");
    }
  });

  it("no provider uses both envPlural and configKey (they're mutually exclusive storage)", () => {
    // Per ProviderSpec's own doc comment: "configKey: set instead of envPlural when it is a
    // single CONFIG value" — a provider is either a rotating key pool OR a single config value,
    // never both. This is the actual check; the version this replaced only asserted the
    // registry's length, which would pass even if every provider violated the invariant.
    const violators = PROVIDER_REGISTRY.filter((p) => p.configKey && p.envPlural).map((p) => p.id);
    expect(violators).toEqual([]);
  });

  it("known starter providers are present", () => {
    const starters = PROVIDER_REGISTRY.filter((p) => p.starter);
    const starterIds = starters.map((p) => p.id);
    // Core starters that should always be there
    expect(starterIds).toContain("cerebras");
    expect(starterIds).toContain("groq");
    expect(starterIds).toContain("gemini");
  });

  it("premium providers are flagged", () => {
    const premium = PROVIDER_REGISTRY.filter((p) => p.premium);
    const ids = premium.map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(premium.every((p) => p.tier === "premium")).toBe(true);
  });
});

describe("derived exports", () => {
  it("POOLED only includes providers with envPlural", () => {
    for (const p of POOLED) {
      expect(p.envPlural).toBeTruthy();
      expect(p.envSingular).toBeTruthy();
    }
  });

  it("PROVIDER_ENV maps id → envPlural for all pooled providers", () => {
    const pooledIds = POOLED.map((p) => p.id);
    for (const id of pooledIds) {
      expect(PROVIDER_ENV[id]).toBeTruthy();
      expect(PROVIDER_ENV[id]).toContain("_API_KEY");
    }
  });

  it("CONFIG_STYLE only includes providers with configKey", () => {
    const configProviders = PROVIDER_REGISTRY.filter((p) => p.configKey);
    expect(Object.keys(CONFIG_STYLE).length).toBe(configProviders.length);
  });
});

describe("uiCatalogue — what leaves the server", () => {
  it("returns all providers", () => {
    const cat = uiCatalogue();
    expect(cat.length).toBe(PROVIDER_REGISTRY.length);
  });

  it("does NOT leak env var names (security boundary)", () => {
    const cat = uiCatalogue();
    for (const item of cat) {
      expect(item).not.toHaveProperty("envPlural");
      expect(item).not.toHaveProperty("envSingular");
      const json = JSON.stringify(item);
      // No env var patterns should appear in the UI payload
      expect(json).not.toContain("_API_KEYS");
    }
  });

  it("every item has the expected UI-safe shape", () => {
    const cat = uiCatalogue();
    for (const item of cat) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("label");
      expect(item).toHaveProperty("tier");
      expect(item).toHaveProperty("note");
      expect(item).toHaveProperty("url");
      expect(typeof item.starter).toBe("boolean");
      expect(typeof item.premium).toBe("boolean");
      expect(typeof item.noKey).toBe("boolean");
      expect(typeof item.configStyle).toBe("boolean");
    }
  });

  it("keyPattern is present for providers that declare one", () => {
    const cat = uiCatalogue();
    const groq = cat.find((c) => c.id === "groq")!;
    expect(groq.keyPattern).toBeTruthy();
    // Groq keys start with gsk_
    expect(new RegExp(groq.keyPattern!).test("gsk_abc123def456ghi789jkl012mno345pq")).toBe(true);
  });
});
