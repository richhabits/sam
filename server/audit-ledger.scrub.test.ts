import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAuditEvent, verifyAuditChainIntegrity } from "./audit-ledger.ts";

// Audit finding: recordAuditEvent stored the first 160 chars of the raw payload on disk. Approved
// tool inputs flow through it (CONFIRM_APPROVE logs `input`), so a token inside a command or
// message landed in a plain-text, default-umask file forever.

describe("audit ledger — secrets and permissions", () => {
  let dir: string;
  let prev: string | undefined;
  beforeAll(() => { prev = process.env.VAULT_DIR; dir = mkdtempSync(join(tmpdir(), "sam-audit-")); process.env.VAULT_DIR = dir; });
  afterAll(() => { if (prev === undefined) delete process.env.VAULT_DIR; else process.env.VAULT_DIR = prev; rmSync(dir, { recursive: true, force: true }); });

  it("redacts credentials from the on-disk summary but keeps the hash chain valid", () => {
    const secret = "sk-ant-abcdefghijklmnopqrstuvwxyz0123456789";
    const e = recordAuditEvent("operator", "CONFIRM_APPROVE", { tool: "run_command", input: { cmd: `curl -H "Authorization: Bearer ${secret}" https://x` } }, "SUCCESS");
    expect(e.payloadSummary).not.toContain(secret);
    expect(e.payloadSummary).toContain("[redacted]");
    expect(readFileSync(join(dir, "audit-chain.jsonl"), "utf8")).not.toContain(secret);
    expect(e.payloadHash).toHaveLength(64);
    expect(verifyAuditChainIntegrity().valid).toBe(true);
  });

  it("creates the ledger 0600", () => {
    recordAuditEvent("system", "BOOT", { ok: true });
    expect(statSync(join(dir, "audit-chain.jsonl")).mode & 0o777).toBe(0o600);
  });
});
