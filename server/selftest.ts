import { TOOLS } from "./tools.ts";
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

export async function runSelftest(): Promise<SelftestReport> {
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
  const toolNames = TOOLS.map(t => t.name);
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

// Allow running directly from CLI `npm run selftest` (async IIFE — no top-level await,
// so this file is safe to bundle under any esbuild target).
if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    console.log("🚀 Running SAM Production Selftest...");
    const report = await runSelftest();
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
