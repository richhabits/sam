/** The tool list is PASSED IN rather than imported: selftest.ts and tools.ts used to import
 *  each other (selftest wanted TOOLS, tools wanted runSelftest), which made module
 *  initialisation order load-bearing and undocumented. Injection removes the cycle and lets a
 *  test hand in any list it likes. */
import { SPECIALISTS, NINJAS } from "./agents.ts";
import { keyStatus } from "./keys.ts";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export interface SelftestReport {
  ok: boolean;
  timestamp: string;
  subsystems: {
    models: { ok: boolean; info: string };
    vault: { ok: boolean; info: string };
    tools: { ok: boolean; count: number; duplicates: number };
    agents: { ok: boolean; count: number; duplicates: number };
  };
}

export async function runSelftest(tools: { name: string }[]): Promise<SelftestReport> {
  let allOk = true;

  // 1. Models — SAM is free/local-first: a working brain = cloud key pools OR local
  //    Ollama (default localhost:11434, no env needed). Probe it for real. This is
  //    reported for visibility but does NOT gate overall health: a fresh checkout or
  //    CI box legitimately has no brain running yet — that's config, not a build defect.
  const ks = keyStatus();
  const validPools = ks.filter(p => p.total > 0 && p.healthy > 0);
  const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
  let ollamaReachable = false;
  try { const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) }); ollamaReachable = r.ok; } catch { /* not running */ }
  const modelsOk = validPools.length > 0 || ollamaReachable;
  const modelsInfo = ollamaReachable
    ? `local Ollama ready${validPools.length ? ` + ${validPools.length} cloud pools` : ""}`
    : validPools.length ? `${validPools.length} cloud pools active`
    : "no brain reachable — start Ollama (ollama serve) or add a free API key";

  // 2. Vault Writability
  let vaultOk = false;
  let vaultInfo = "Not checked";
  try {
    const root = join(process.cwd(), "vault");
    if (existsSync(root)) {
      const testFile = join(root, ".selftest");
      writeFileSync(testFile, "test");
      unlinkSync(testFile);
      vaultOk = true;
      vaultInfo = "Writable";
    } else {
      vaultInfo = "Vault directory missing";
    }
  } catch (e: any) {
    vaultInfo = e.message;
  }
  if (!vaultOk) allOk = false;

  // 3. Tools
  const toolNames = tools.map((t) => t.name);
  const uniqueTools = new Set(toolNames);
  const toolsOk = uniqueTools.size === toolNames.length && toolNames.length > 0;
  if (!toolsOk) allOk = false;

  // 4. Agents
  const allAgents = [...SPECIALISTS, ...NINJAS];
  const agentIds = allAgents.map(a => a.id);
  const uniqueAgents = new Set(agentIds);
  const agentsOk = uniqueAgents.size === agentIds.length && agentIds.length > 0;
  if (!agentsOk) allOk = false;

  return {
    ok: allOk,
    timestamp: new Date().toISOString(),
    subsystems: {
      models: { ok: modelsOk, info: modelsInfo },
      vault: { ok: vaultOk, info: vaultInfo },
      tools: { ok: toolsOk, count: toolNames.length, duplicates: toolNames.length - uniqueTools.size },
      agents: { ok: agentsOk, count: agentIds.length, duplicates: agentIds.length - uniqueAgents.size }
    }
  };
}

// Run the CLI ONLY when this file is the process entry (`tsx server/selftest.ts`).
// Guard on the entry FILENAME, not `import.meta.url === file://argv[1]` — once esbuild
// bundles this into dist/server.mjs, that comparison is true for the bundle too, so the
// server would run the selftest and process.exit() at boot on any space-free path.
if (/[\\/]selftest\.(ts|mjs|js|cjs)$/.test(process.argv[1] || "")) {
  (async () => {
    console.log("🚀 Running SAM Production Selftest...");
    // Dynamic import, deliberately: this is the CLI entry, so it needs the real registry, but a
    // top-level import would restore the very cycle this file was changed to remove. Resolved at
    // call time, when tools.ts is fully evaluated.
    const { TOOLS } = await import("./tools.ts");
    const report = await runSelftest(TOOLS);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      console.error("❌ Selftest failed!");
      process.exit(1);
    } else {
      console.log("✅ All subsystems green!");
      process.exit(0);
    }
  })();
}
