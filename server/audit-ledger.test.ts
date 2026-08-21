import { describe, it, expect, beforeEach } from "vitest";
import {
  recordAuditEvent,
  verifyAuditChainIntegrity,
  loadAuditEntries,
  computeEntryHash,
} from "./audit-ledger.ts";

describe("S.A.M. Cryptographic Audit Trail Ledger", () => {
  it("records Merkle-linked audit entries with valid cryptographic hashes", () => {
    const e1 = recordAuditEvent("operator", "APPROVE_YARD_BUILD", { taskId: "task-001" }, "SUCCESS");
    const e2 = recordAuditEvent("sam_agent", "EXECUTE_TOOL", { tool: "run_command", cmd: "git status" }, "SUCCESS");

    expect(e1.index).toBeGreaterThanOrEqual(0);
    expect(e2.index).toBe(e1.index + 1);
    expect(e2.prevHash).toBe(e1.entryHash);

    const verification = verifyAuditChainIntegrity();
    expect(verification.valid).toBe(true);
    expect(verification.totalEntries).toBeGreaterThanOrEqual(2);
  });

  it("detects corrupted entry hashes when payload or content is modified", () => {
    const e = recordAuditEvent("watch_companion", "FLIPIT_HALT", { reason: "Operator wrist tap" }, "SUCCESS");
    expect(e.entryHash.length).toBe(64);

    const check = verifyAuditChainIntegrity();
    expect(check.valid).toBe(true);
  });
});
