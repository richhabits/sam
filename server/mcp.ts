// ─────────────────────────────────────────────────────────────
//  S.A.M. · MCP — plug into the Model Context Protocol ecosystem
//  Thousands of community MCP servers (Gmail, Notion, Postgres,
//  browsers, smart home…) become SAM tools with zero code.
//
//  Setup: create vault/mcp.json (gitignored — copy mcp.sample.json):
//    { "servers": [ { "name": "github",
//        "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
//        "env": { "GITHUB_TOKEN": "..." } } ] }
//  Restart SAM → each server's tools appear as mcp_<server>_<tool>.
//  MCP tools are ALWAYS ask-first (they're third-party code — SAM
//  can't vouch for what they do), and env values stay local.
// ─────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "./tools.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(process.env.VAULT_DIR || join(ROOT, "vault"), "mcp.json");

interface McpServerConfig { name: string; command: string; args?: string[]; env?: Record<string, string> }

const clients: Client[] = [];   // kept alive for the process lifetime

export async function loadMcpTools(): Promise<Tool[]> {
  if (!existsSync(CONFIG)) return [];
  let servers: McpServerConfig[] = [];
  try {
    const cfg = JSON.parse(readFileSync(CONFIG, "utf8"));
    servers = Array.isArray(cfg?.servers) ? cfg.servers : [];
  } catch (e: any) {
    console.log(`  ⚠️ mcp.json unreadable (${String(e?.message).slice(0, 60)}) — skipping MCP`);
    return [];
  }
  const out: Tool[] = [];
  for (const s of servers) {
    if (!s?.name || !s?.command) continue;
    const label = String(s.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24);
    try {
      const transport = new StdioClientTransport({
        command: s.command,
        args: s.args || [],
        env: { ...process.env as Record<string, string>, ...(s.env || {}) },
      });
      const client = new Client({ name: "sam", version: "1.0.0" });
      await client.connect(transport);
      clients.push(client);
      const { tools } = await client.listTools();
      for (const t of tools) {
        const name = `mcp_${label}_${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`.slice(0, 60);
        const props = Object.keys((t.inputSchema as any)?.properties || {});
        out.push({
          name,
          safe: false,   // third-party code — always ask first
          description: `[${s.name} · MCP] ${t.description || t.name}. input: {${props.join(", ")}}.`,
          params: `{${props.join(", ")}}`,
          activity: () => `Using ${s.name} · ${t.name}`,
          preview: (input) => `MCP tool ${s.name}/${t.name}\nInput: ${JSON.stringify(input ?? {}, null, 1).slice(0, 400)}`,
          run: async (input) => {
            const res = await client.callTool({ name: t.name, arguments: (input && typeof input === "object") ? input : {} });
            const parts = Array.isArray(res?.content) ? res.content : [];
            const text = parts.map((p: any) => (p?.type === "text" ? p.text : `[${p?.type || "content"}]`)).join("\n").trim();
            return text || "(MCP tool ran, no text output)";
          },
        });
      }
      console.log(`  🔌 MCP linked    · ${s.name} (${tools.length} tool${tools.length === 1 ? "" : "s"})`);
    } catch (e: any) {
      console.log(`  ⚠️ MCP "${s.name}" failed to start: ${String(e?.message || e).slice(0, 80)}`);
    }
  }
  return out;
}
