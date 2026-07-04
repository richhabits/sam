// ─────────────────────────────────────────────────────────────
//  S.A.M. · core tests
//  Pure-logic coverage for the four modules that must never break:
//  skill routing, skill loading, vault memory, model fallback.
//  No network, no keys — runs 100% offline.
// ─────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSkills, routeSkill } from "./skills.ts";
import { PROJECTS, projectById } from "./projects.ts";
import { TOOLS, toolByName, toolCatalogue } from "./tools.ts";

// ── THE BRAIN · skill routing ────────────────────────────────
describe("routeSkill", () => {
  const skills = loadSkills();

  it("loads every shipped skill with a playbook body", () => {
    expect(skills.length).toBeGreaterThanOrEqual(9);
    for (const s of skills) {
      expect(s.id).toBeTruthy();
      expect(s.body.length).toBeGreaterThan(0);
      expect(["local", "free", "premium"]).toContain(s.tier);
    }
  });

  it("includes the absorbed browse + research skills", () => {
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("browse");
    expect(ids).toContain("research");
  });

  it("routes a deploy message to the build skill", () => {
    const hit = routeSkill("can you deploy and build the new code", skills);
    expect(hit?.id).toBe("build");
  });

  it("routes a crawl/URL message to the research skill", () => {
    const hit = routeSkill("research this competitor and crawl their site", skills);
    expect(hit?.id).toBe("research");
  });

  it("routes a login/checkout action to the browse skill", () => {
    const hit = routeSkill("log in to the portal and checkout for me", skills);
    expect(hit?.id).toBe("browse");
  });

  it("routes an email message to the comms skill", () => {
    const hit = routeSkill("draft a reply to this email", skills);
    expect(hit?.id).toBe("comms");
  });

  it("returns null when nothing matches (OS-level answer)", () => {
    const hit = routeSkill("zzzzz qqqqq no triggers here", skills);
    expect(hit).toBeNull();
  });
});

// ── THE HANDS · tools (safety) ───────────────────────────────
describe("tools", () => {
  it("classifies read-only tools as safe and actions as ask-first", () => {
    const safe = ["web_search", "web_fetch", "read_file", "list_dir", "screenshot"];
    const risky = ["run_command", "write_file", "applescript", "type_text", "click"];
    for (const n of safe) expect(toolByName(n)?.safe, n).toBe(true);
    for (const n of risky) expect(toolByName(n)?.safe, n).toBe(false);
  });

  it("every tool has a name, description and activity label", () => {
    for (const t of TOOLS) {
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.activity).toBe("function");
    }
    expect(toolCatalogue()).toMatch(/web_search/);
  });

  it("blocks catastrophic commands even when run directly", async () => {
    const out = await toolByName("run_command")!.run({ command: "rm -rf ~/" });
    expect(out).toMatch(/blocked/i);
  });
});

// ── brand context ────────────────────────────────────────────
describe("projects", () => {
  it("tracks the user's brands and resolves by id", () => {
    expect(PROJECTS.length).toBeGreaterThanOrEqual(10);
    const first = PROJECTS[0];
    expect(projectById(first.id)?.name).toBe(first.name);
    expect(projectById("does-not-exist")).toBeUndefined();
  });
});

// ── THE MEMORY · vault (isolated temp dir) ───────────────────
describe("vault", () => {
  let vault: ReturnType<typeof importVaultWithDir> extends Promise<infer T> ? T : never;

  // vault.ts reads VAULT_DIR at import time, so point it at a temp dir
  // and import a fresh module instance for the test.
  function importVaultWithDir() {
    const dir = mkdtempSync(join(tmpdir(), "sam-vault-"));
    process.env.VAULT_DIR = dir;
    vi.resetModules();
    return import("./vault.ts").then((m) => ({ ...m, dir }));
  }

  beforeEach(async () => {
    vault = await importVaultWithDir();
  });

  it("writes an exchange to a daily note and reads it back", () => {
    vault.logExchange({
      user: "status?",
      sam: "all systems green",
      skill: "ops",
      project: "ghost-detail",
      provider: "ollama:llama3.2:3b",
    });
    const log = vault.recentLog(5);
    expect(log.length).toBe(1);
    const stats = vault.vaultStats();
    expect(stats.dailyNotes).toBe(1);
  });

  it("builds a graph with wikilink edges", () => {
    vault.logExchange({
      user: "hi", sam: "hi", skill: "brand", project: "hectic-bullz", provider: "gemini",
    });
    const graph = vault.buildGraph();
    expect(graph.nodes.length).toBeGreaterThan(0);
    // the [[hectic-bullz]] link should appear as a node
    expect(graph.nodes.some((n: any) => n.id === "hectic-bullz")).toBe(true);
  });
});

// ── THE ROUTER · model fallback (mocked, no network) ─────────
describe("runModel fallback", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("falls back through the chain and never throws when a provider works", async () => {
    // local (ollama) succeeds via mocked fetch
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: "local reply" } }), { status: 200 })
    ));
    const { runModel } = await import("./models.ts");
    const r = await runModel("local", "sys", "hello");
    expect(r.text).toBe("local reply");
    expect(r.provider).toContain("ollama");
    vi.unstubAllGlobals();
  });

  it("returns a graceful offline message when every provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    const { runModel } = await import("./models.ts");
    const r = await runModel("local", "sys", "hello");
    expect(r.provider).toBe("none");
    expect(r.text).toMatch(/offline/i);
    vi.unstubAllGlobals();
  });

  it("uses a free cloud provider (Groq) when a key is pooled and local is down", async () => {
    process.env.GROQ_API_KEYS = "test-key-1,test-key-2";
    vi.resetModules();
    // local ollama fails; groq (OpenAI-compatible) succeeds
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("11434")) return new Response("", { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "groq reply" } }] }), { status: 200 });
    }));
    const { runModel } = await import("./models.ts");
    const r = await runModel("free", "sys", "hello");
    expect(r.text).toBe("groq reply");
    expect(r.provider).toContain("groq");
    expect(r.tier).toBe("free");
    vi.unstubAllGlobals();
    delete process.env.GROQ_API_KEYS;
  });
});

// ── THE KEY VAULT · rotation + pooling (no network) ──────────
describe("key pool", () => {
  beforeEach(() => vi.resetModules());

  it("rotates round-robin across pooled keys and dedupes", async () => {
    process.env.GROQ_API_KEYS = "a,b,a"; // duplicate 'a' should collapse
    vi.resetModules();
    const { getKey, poolSize } = await import("./keys.ts");
    expect(poolSize("groq")).toBe(2);
    const seen = [getKey("groq"), getKey("groq"), getKey("groq")];
    expect(seen).toEqual(["a", "b", "a"]);
    delete process.env.GROQ_API_KEYS;
  });

  it("cools a key down after a 429 and skips it", async () => {
    process.env.GROQ_API_KEYS = "x,y";
    vi.resetModules();
    const { getKey, reportFailure } = await import("./keys.ts");
    const first = getKey("groq");           // x
    reportFailure("groq", first!, 429);      // x cools down 60s
    const next = getKey("groq");             // should skip x -> y
    expect(next).toBe("y");
    delete process.env.GROQ_API_KEYS;
  });
});
