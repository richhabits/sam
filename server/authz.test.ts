import { describe, it, expect, beforeEach } from "vitest";
import { mayAutoRun, toolTier, allow, disallow, isAllowed, setAutopilot, setElonMode } from "./authz.ts";

describe("permission tiers (v1.2 security hardening)", () => {
  beforeEach(() => {
    setAutopilot(false); setElonMode(false);
    ["send_email", "git_push", "write_file", "play"].forEach(disallow);
  });

  it("classifies every tool as dangerous / confirm / safe", () => {
    expect(toolTier("send_email", false)).toBe("dangerous");
    expect(toolTier("run_command", false)).toBe("dangerous");
    expect(toolTier("git_push", false)).toBe("dangerous");
    expect(toolTier("empty_trash", false)).toBe("dangerous");
    expect(toolTier("kill_port", false)).toBe("dangerous");
    expect(toolTier("manage_authorizations", false)).toBe("dangerous");
    expect(toolTier("write_file", false)).toBe("confirm");
    expect(toolTier("git_commit", false)).toBe("confirm");
    expect(toolTier("web_search", true)).toBe("safe");
  });

  it("dangerous tools NEVER auto-run under Autopilot", () => {
    setAutopilot(true);
    for (const t of ["send_email", "git_push", "run_command", "empty_trash", "manage_authorizations", "kill_port", "applescript"])
      expect(mayAutoRun(t)).toBe(false);
  });

  it("dangerous tools NEVER auto-run in a Swarm — even in Elon Mode", () => {
    setElonMode(true);
    for (const t of ["send_email", "run_command", "git_push", "trash_file"])
      expect(mayAutoRun(t, /* swarm */ true)).toBe(false);
  });

  it("interactive Elon Mode MAY skip dangerous (opt-in off-leash), a swarm never does", () => {
    setElonMode(true);
    expect(mayAutoRun("send_email", false)).toBe(true);   // user present, opted in
    expect(mayAutoRun("send_email", true)).toBe(false);   // unattended swarm — still gated
  });

  it("a standing 'always allow' can NOT whitelist a dangerous tool", () => {
    allow("send_email");
    expect(isAllowed("send_email")).toBe(false);          // refused at the source
    expect(mayAutoRun("send_email")).toBe(false);
  });

  it("confirm-tier tools ARE skippable by Autopilot or a standing allow", () => {
    expect(mayAutoRun("write_file")).toBe(false);         // default: asks
    setAutopilot(true);
    expect(mayAutoRun("write_file")).toBe(true);          // Autopilot skips
    setAutopilot(false);
    allow("write_file");
    expect(mayAutoRun("write_file")).toBe(true);          // standing allow skips
  });
});
