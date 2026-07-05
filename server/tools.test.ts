import { describe, it, expect } from "vitest";
import { TOOLS } from "./tools.ts";

describe("Tool Registry Integrity", () => {
  it("exports a non-empty array of tools", () => {
    expect(TOOLS).toBeInstanceOf(Array);
    expect(TOOLS.length).toBeGreaterThan(0);
  });

  it("ensures no duplicate tool names exist", () => {
    const names = TOOLS.map(t => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it("validates that all tools conform to the base schema", () => {
    for (const t of TOOLS) {
      expect(typeof t.name).toBe("string");
      expect(t.name).toMatch(/^[a-z0-9_]+$/);
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(10);
      expect(typeof t.run).toBe("function");
      if (t.params) {
        expect(typeof t.params).toBe("string");
      }
    }
  });

  it("enforces safe flag on destructive tools", () => {
    // These tools are inherently outward/destructive and MUST be marked safe: false
    const destructiveNames = [
      "run_command", "write_file", "replace_content", "delete_file",
      "git_commit", "git_push", "forget_memory", "send_email",
      "npm_install", "uninstall_dep", "spawn_agent", "pause_agent",
      "create_project"
    ];

    for (const name of destructiveNames) {
      const tool = TOOLS.find(t => t.name === name);
      if (tool) {
        expect(tool.safe).toBe(false);
      }
    }
  });

  it("contains at least one tool per major category (OS, web, memory, git)", () => {
    const names = TOOLS.map(t => t.name);
    expect(names).toContain("run_command"); // OS
    expect(names).toContain("web_fetch"); // Web
    expect(names).toContain("remember_fact"); // Memory
    expect(names).toContain("git_commit"); // Git
  });
});
