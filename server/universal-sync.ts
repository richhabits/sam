// ─────────────────────────────────────────────────────────────
//  S.A.M. · UNIVERSAL VAULT SNAPSHOT & BACKUP ENGINE
//
//  Generates verified, portable vault snapshots with SHA-256 integrity
//  checksums and safe, non-destructive import restoration.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileAtomic } from "./atomic.ts";

export interface VaultFileEntry {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  contentBase64: string;
}

export interface VaultSnapshotManifest {
  version: "1.0.0";
  exportedAt: number;
  vaultPath: string;
  totalFiles: number;
  totalSizeBytes: number;
  manifestChecksum: string;
  files: VaultFileEntry[];
}

export interface RestoreResult {
  restoredCount: number;
  skippedCount: number;
  errors: string[];
  restoredFiles: string[];
  manifestExportedAt: number;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VAULT_DIR = () => process.env.VAULT_DIR || join(ROOT, "vault");

// A restore writes files the operator never reviewed, into the directory SAM reads its trust
// decisions and credentials from. So restore is an ALLOWLIST of plain user-data files, not "anything
// without a .." — mcp.json (spawns commands), .env, push-keys.json, the signing/tls dirs, sessions*,
// authorized.json / consent.json (standing permissions) and entitlement.json are all absent on
// purpose and are refused. Names are matched exactly against a flat file name: no separators.
export const RESTORABLE_VAULT_FILES: ReadonlySet<string> = new Set([
  "analytics.json",
  "brands.json",
  "cost_savings_ledger.json",
  "moments.json",
  "socials.json",
  "routing_cache.json",
  "semantic_cache.json",
  "facts.md",
  "memory.json",
  "preferences.json",
  "chimes.json",
]);

/** Files a snapshot never EXPORTS: they run commands or hold credentials, and restore refuses them anyway. */
export function isExportExcluded(name: string): boolean {
  const n = name.toLowerCase();
  return n === "mcp.json" || n === "push-keys.json" || n === ".env" || n.startsWith(".env") || n.startsWith("sessions");
}

/**
 * Computes SHA-256 hash of a buffer or string.
 */
function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Creates an exportable snapshot of the SAM vault with checksums.
 */
export function createVaultSnapshot(): VaultSnapshotManifest {
  const vaultDir = VAULT_DIR();
  const fileEntries: VaultFileEntry[] = [];

  if (existsSync(vaultDir)) {
    const filenames = readdirSync(vaultDir);
    for (const name of filenames) {
      if (name.startsWith(".") || name.includes("tmp") || isExportExcluded(name)) continue;
      const full = join(vaultDir, name);
      try {
        const buf = readFileSync(full);
        fileEntries.push({
          relativePath: name,
          sizeBytes: buf.length,
          sha256: sha256(buf),
          contentBase64: buf.toString("base64"),
        });
      } catch {
        // Skip unreadable files
      }
    }
  }

  const totalSizeBytes = fileEntries.reduce((acc, f) => acc + f.sizeBytes, 0);
  const rawManifest = JSON.stringify(fileEntries);
  const manifestChecksum = sha256(rawManifest);

  return {
    version: "1.0.0",
    exportedAt: Date.now(),
    vaultPath: vaultDir,
    totalFiles: fileEntries.length,
    totalSizeBytes,
    manifestChecksum,
    files: fileEntries,
  };
}

/**
 * Restores a snapshot into the vault after verifying SHA-256 integrity.
 */
export function restoreVaultSnapshot(manifest: VaultSnapshotManifest): RestoreResult {
  const vaultDir = VAULT_DIR();
  mkdirSync(vaultDir, { recursive: true });

  const restoredFiles: string[] = [];
  const errors: string[] = [];
  let restoredCount = 0;
  let skippedCount = 0;

  if (!manifest || !Array.isArray(manifest.files)) {
    throw new Error("Invalid manifest: missing files array.");
  }

  for (const f of manifest.files) {
    if (typeof f.relativePath !== "string" || !f.relativePath || typeof f.contentBase64 !== "string" || !f.contentBase64) {
      skippedCount++;
      continue;
    }

    // Guard against path traversal
    if (f.relativePath.includes("..") || f.relativePath.startsWith("/")) {
      errors.push(`Rejected unsafe file path: ${f.relativePath}`);
      skippedCount++;
      continue;
    }
    if (!RESTORABLE_VAULT_FILES.has(f.relativePath)) {
      errors.push(`Refused to restore ${String(f.relativePath)}: not an allowlisted vault file`);
      skippedCount++;
      continue;
    }

    try {
      const buf = Buffer.from(f.contentBase64, "base64");
      const computedHash = sha256(buf);

      if (f.sha256 && computedHash !== f.sha256) {
        errors.push(`Checksum mismatch for ${f.relativePath}`);
        skippedCount++;
        continue;
      }

      const dest = join(vaultDir, f.relativePath);
      // Atomic + 0600: a crash mid-restore can't leave a truncated file, and nothing lands world-readable.
      writeFileAtomic(dest, buf, { mode: 0o600 });
      restoredFiles.push(f.relativePath);
      restoredCount++;
    } catch (e: any) {
      errors.push(`Failed to restore ${f.relativePath}: ${e?.message || e}`);
      skippedCount++;
    }
  }

  return {
    restoredCount,
    skippedCount,
    errors,
    restoredFiles,
    manifestExportedAt: manifest.exportedAt || Date.now(),
  };
}
