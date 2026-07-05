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

export function runSelftest(): SelftestReport {
  let allOk = true;

  // 1. Models
  const ks = keyStatus();
  const validPools = ks.filter(p => p.total > 0 && p.healthy > 0);
  const modelsOk = validPools.length > 0 || process.env.OLLAMA_URL !== undefined;
  if (!modelsOk) allOk = false;

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
      models: { ok: modelsOk, info: `${validPools.length} cloud pools active` },
      vault: { ok: vaultOk, info: vaultInfo },
      tools: { ok: toolsOk, count: toolNames.length, duplicates: toolNames.length - uniqueTools.size },
      agents: { ok: agentsOk, count: agentIds.length, duplicates: agentIds.length - uniqueAgents.size }
    }
  };
}

// Allow running directly from CLI `npm run selftest`
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("🚀 Running SAM Production Selftest...");
  const report = runSelftest();
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    console.error("❌ Selftest failed!");
    process.exit(1);
  } else {
    console.log("✅ All subsystems green!");
    process.exit(0);
  }
}
