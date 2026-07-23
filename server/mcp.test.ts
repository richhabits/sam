import { describe, it, expect } from "vitest";
import { mcpEnv } from "./mcp.ts";

// A third-party MCP server is code SAM did not write. The one promise the loader makes is
// that SAM's own secrets never cross into it — these tests are that promise.
describe("the environment handed to a third-party MCP server", () => {
  it("does NOT carry SAM's provider keys or vault secrets", () => {
    process.env.GROQ_API_KEY = "gsk_leak_canary";
    process.env.OPENAI_API_KEY = "sk-leak-canary";
    process.env.SAM_PASSKEY = "handshake-canary";
    try {
      const env = mcpEnv();
      const values = Object.values(env).join(" ");
      expect(values).not.toMatch(/gsk_leak_canary/);
      expect(values).not.toMatch(/sk-leak-canary/);
      expect(values).not.toMatch(/handshake-canary/);
      expect(Object.keys(env)).not.toContain("GROQ_API_KEY");
      expect(Object.keys(env)).not.toContain("OPENAI_API_KEY");
    } finally {
      delete process.env.GROQ_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.SAM_PASSKEY;
    }
  });

  it("carries enough base env to locate and run the server's binary", () => {
    const env = mcpEnv();
    expect(env.PATH).toBeTruthy();          // or the subprocess cannot find node/npx
  });

  it("carries exactly the variables the server's own config declares", () => {
    const env = mcpEnv({ GITHUB_TOKEN: "ghp_declared_by_config" });
    expect(env.GITHUB_TOKEN).toBe("ghp_declared_by_config");   // its OWN token belongs here
  });
});
