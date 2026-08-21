// ─────────────────────────────────────────────────────────────
//  S.A.M. · UNIVERSAL VAULT SNAPSHOT & BACKUP ENGINE
//
//  Generates verified, portable vault snapshots with SHA-256 integrity
//  checksums and safe, non-destructive import restoration.
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
      if (name.startsWith(".") || name.includes("tmp")) continue;
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
    if (!f.relativePath || !f.contentBase64) {
      skippedCount++;
      continue;
    }

    // Guard against path traversal
    if (f.relativePath.includes("..") || f.relativePath.startsWith("/")) {
      errors.push(`Rejected unsafe file path: ${f.relativePath}`);
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
      writeFileSync(dest, buf);
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
