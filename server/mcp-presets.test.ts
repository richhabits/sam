import { describe, expect, it } from "vitest";
import { MCP_PRESETS } from "./mcp-presets.ts";

// FLIP IT is its own app; inside SAM it is only an opt-in, read-only MCP add-on.
describe("FLIP IT add-on preset", () => {
  const flipit = MCP_PRESETS.find((p) => p.id === "flipit");

  it("exists and is labelled as an add-on", () => {
    expect(flipit).toBeDefined();
    expect(flipit!.label).toMatch(/add-on/i);
  });

  it("needs no keys — it reads the local rig, nothing to leak", () => {
    expect(flipit!.fields).toEqual([]);
  });

  it("launches through python, not a shell, so it also runs on Windows", () => {
    expect(flipit!.command).toBe("python3");
    expect(["sh", "bash", "zsh", "cmd", "powershell"]).not.toContain(flipit!.command);
    expect(flipit!.args.join(" ")).toContain("flipit_mcp.py");
  });

  it("promises read-only in its note", () => {
    expect(flipit!.note).toMatch(/read-only/i);
    expect(flipit!.note).toMatch(/never trades/i);
  });
});

describe("MCP presets", () => {
  it("ids are unique", () => {
    const ids = MCP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
