import { describe, it, expect } from "vitest";
import { createVaultSnapshot, restoreVaultSnapshot, type VaultSnapshotManifest } from "./universal-sync.ts";

describe("UNIVERSAL VAULT SNAPSHOT & BACKUP ENGINE", () => {
  it("creates a vault snapshot with SHA-256 integrity checksums", () => {
    const snapshot = createVaultSnapshot();
    expect(snapshot.version).toBe("1.0.0");
    expect(snapshot.exportedAt).toBeGreaterThan(0);
    expect(snapshot.manifestChecksum).toHaveLength(64);
    expect(Array.isArray(snapshot.files)).toBe(true);
  });

  it("restores valid files and rejects unsafe path traversal", () => {
    const manifest: VaultSnapshotManifest = {
      version: "1.0.0",
      exportedAt: Date.now(),
      vaultPath: "/tmp/mock-vault",
      totalFiles: 2,
      totalSizeBytes: 100,
      manifestChecksum: "mock_checksum",
      files: [
        {
          relativePath: "test-snapshot-entry.json",
          sizeBytes: 15,
          sha256: "",
          contentBase64: Buffer.from("{\"mock\": true}").toString("base64"),
        },
        {
          relativePath: "../../../etc/passwd",
          sizeBytes: 20,
          sha256: "",
          contentBase64: Buffer.from("malicious payload").toString("base64"),
        },
      ],
    };

    const res = restoreVaultSnapshot(manifest);
    expect(res.restoredCount).toBe(1);
    expect(res.skippedCount).toBe(1);
    expect(res.restoredFiles).toContain("test-snapshot-entry.json");
    expect(res.errors[0]).toContain("Rejected unsafe file path");
  });
});
