import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createVaultSnapshot, restoreVaultSnapshot, type VaultSnapshotManifest } from "./universal-sync.ts";

const entry = (relativePath: string, body: string) => ({
  relativePath,
  sizeBytes: body.length,
  sha256: "",
  contentBase64: Buffer.from(body).toString("base64"),
});
const manifest = (files: ReturnType<typeof entry>[]): VaultSnapshotManifest => ({
  version: "1.0.0", exportedAt: Date.now(), vaultPath: "x", totalFiles: files.length, totalSizeBytes: 0, manifestChecksum: "x", files,
});

describe("UNIVERSAL VAULT SNAPSHOT & BACKUP ENGINE", () => {
  let dir: string;
  const prev = process.env.VAULT_DIR;
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "sam-vault-")); process.env.VAULT_DIR = dir; });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); if (prev === undefined) delete process.env.VAULT_DIR; else process.env.VAULT_DIR = prev; });

  it("creates a vault snapshot with SHA-256 integrity checksums", () => {
    const snapshot = createVaultSnapshot();
    expect(snapshot.version).toBe("1.0.0");
    expect(snapshot.manifestChecksum).toHaveLength(64);
    expect(Array.isArray(snapshot.files)).toBe(true);
  });

  it("restores allowlisted files atomically at 0600 and rejects path traversal", () => {
    const res = restoreVaultSnapshot(manifest([entry("moments.json", '{"ok":true}'), entry("../../../etc/passwd", "x")]));
    expect(res.restoredFiles).toEqual(["moments.json"]);
    expect(res.errors[0]).toContain("Rejected unsafe file path");
    expect(readFileSync(join(dir, "moments.json"), "utf8")).toBe('{"ok":true}');
    expect(statSync(join(dir, "moments.json")).mode & 0o777).toBe(0o600);
  });

  it("refuses files that execute commands or hold credentials", () => {
    const bad = ["mcp.json", ".env", "push-keys.json", "sessions.db", "sessions.db-wal", "authorized.json", "signing/key.pem", "tls/server.key", "unknown.txt"];
    const res = restoreVaultSnapshot(manifest(bad.map((n) => entry(n, "pwned"))));
    expect(res.restoredCount).toBe(0);
    expect(res.skippedCount).toBe(bad.length);
    for (const n of ["mcp.json", ".env", "push-keys.json", "sessions.db"]) expect(existsSync(join(dir, n))).toBe(false);
  });

  it("never exports mcp.json, sessions*, push-keys.json or .env", () => {
    for (const n of ["mcp.json", "sessions.db", "sessions.db-wal", "push-keys.json", ".env", "moments.json"]) writeFileSync(join(dir, n), "x");
    const names = createVaultSnapshot().files.map((f) => f.relativePath);
    expect(names).toContain("moments.json");
    for (const n of ["mcp.json", "sessions.db", "sessions.db-wal", "push-keys.json", ".env"]) expect(names).not.toContain(n);
  });
});
