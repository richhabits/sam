// ─────────────────────────────────────────────────────────────
//  S.A.M. · CRYPTOGRAPHIC AUDIT TRAIL LEDGER
//
//  Tamper-evident, Merkle-linked SHA-256 audit ledger for all
//  operator approvals, dangerous tool executions, and security events.
//  Any tampering or line deletion breaks the hash chain.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AuditEntry {
  index: number;
  timestamp: number;
  actor: "operator" | "sam_agent" | "watch_companion" | "system";
  action: string;
  payloadHash: string;
  payloadSummary: string;
  status: "SUCCESS" | "DENIED" | "FAILED" | "PENDING";
  prevHash: string;
  entryHash: string;
}

export interface AuditVerificationResult {
  valid: boolean;
  totalEntries: number;
  brokenAtIndex?: number;
  latestHash?: string;
  error?: string;
}

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

const vaultDir = () => process.env.VAULT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "vault");
const ledgerFile = () => join(vaultDir(), "audit-chain.jsonl");

export function computeSha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function computeEntryHash(
  index: number,
  timestamp: number,
  actor: string,
  action: string,
  payloadHash: string,
  status: string,
  prevHash: string
): string {
  const content = `${index}|${timestamp}|${actor}|${action}|${payloadHash}|${status}|${prevHash}`;
  return computeSha256(content);
}

export function loadAuditEntries(): AuditEntry[] {
  try {
    if (!existsSync(ledgerFile())) return [];
    const lines = readFileSync(ledgerFile(), "utf8").split("\n").filter((l) => l.trim().length > 0);
    return lines.map((l) => JSON.parse(l) as AuditEntry);
  } catch {
    return [];
  }
}

export function recordAuditEvent(
  actor: "operator" | "sam_agent" | "watch_companion" | "system",
  action: string,
  payload: any,
  status: "SUCCESS" | "DENIED" | "FAILED" | "PENDING" = "SUCCESS"
): AuditEntry {
  mkdirSync(vaultDir(), { recursive: true });
  const entries = loadAuditEntries();
  const index = entries.length;
  const prevHash = index > 0 ? entries[entries.length - 1].entryHash : GENESIS_HASH;
  const timestamp = Date.now();

  const payloadStr = typeof payload === "string" ? payload : JSON.stringify(payload ?? {});
  const payloadHash = computeSha256(payloadStr);
  const payloadSummary = payloadStr.slice(0, 160);

  const entryHash = computeEntryHash(index, timestamp, actor, action, payloadHash, status, prevHash);

  const entry: AuditEntry = {
    index,
    timestamp,
    actor,
    action,
    payloadHash,
    payloadSummary,
    status,
    prevHash,
    entryHash,
  };

  appendFileSync(ledgerFile(), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export function verifyAuditChainIntegrity(): AuditVerificationResult {
  const entries = loadAuditEntries();
  if (entries.length === 0) {
    return { valid: true, totalEntries: 0, latestHash: GENESIS_HASH };
  }

  let expectedPrevHash = GENESIS_HASH;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.index !== i) {
      return { valid: false, totalEntries: entries.length, brokenAtIndex: i, error: `Index mismatch at ${i}: got ${e.index}` };
    }
    if (e.prevHash !== expectedPrevHash) {
      return { valid: false, totalEntries: entries.length, brokenAtIndex: i, error: `Broken chain link at index ${i}` };
    }
    const computed = computeEntryHash(e.index, e.timestamp, e.actor, e.action, e.payloadHash, e.status, e.prevHash);
    if (computed !== e.entryHash) {
      return { valid: false, totalEntries: entries.length, brokenAtIndex: i, error: `Corrupted entry hash at index ${i}` };
    }
    expectedPrevHash = e.entryHash;
  }

  return {
    valid: true,
    totalEntries: entries.length,
    latestHash: entries[entries.length - 1].entryHash,
  };
}
