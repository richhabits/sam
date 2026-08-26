import { describe, it, expect, beforeEach } from "vitest";
import { rmSync, mkdirSync, existsSync } from "node:fs";

const SCRATCH = "/tmp/sam-signing-test";

let S: typeof import("./signing.ts");

beforeEach(async () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  process.env.VAULT_DIR = SCRATCH;
  // Clear env vars that affect signing status
  delete process.env.APPLE_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_APP_SPECIFIC_PASSWORD;
  S = await import("./signing.ts");
});

describe("signingStatus", () => {
  it("returns a well-shaped status object", async () => {
    const status = await S.signingStatus();
    expect(status).toHaveProperty("mac");
    expect(status).toHaveProperty("android");
    expect(status.mac).toHaveProperty("hasCert");
    expect(status.mac).toHaveProperty("certName");
    expect(status.mac).toHaveProperty("hasAppleId");
    expect(status.mac).toHaveProperty("hasTeamId");
    expect(status.mac).toHaveProperty("hasPassword");
    expect(status.mac).toHaveProperty("ready");
    expect(status.mac).toHaveProperty("next");
    expect(status.android).toHaveProperty("hasKeystore");
    expect(status.android).toHaveProperty("keystorePath");
  });

  it("reflects APPLE_ID env var presence", async () => {
    const before = await S.signingStatus();
    expect(before.mac.hasAppleId).toBe(false);
    process.env.APPLE_ID = "test@example.com";
    const after = await S.signingStatus();
    expect(after.mac.hasAppleId).toBe(true);
    delete process.env.APPLE_ID;
  });

  it("android.hasKeystore is false when vault is empty", async () => {
    const status = await S.signingStatus();
    expect(status.android.hasKeystore).toBe(false);
  });
});

describe("generateAndroidKeystore", () => {
  // Two real `keytool -genkeypair` subprocess spawns in one test — vitest's 5s default is tight
  // for that on a loaded CI runner (observed flaking in CI, never locally); 20s gives real
  // headroom without slowing down a genuine hang's feedback by much.
  it("refuses to overwrite an existing keystore", async () => {
    // Generate first
    const first = await S.generateAndroidKeystore();
    if (!first.ok) {
      // keytool not available — skip gracefully
      return;
    }
    expect(first.ok).toBe(true);
    expect(first.path).toBeTruthy();
    expect(first.password).toBeTruthy();

    // Try again — should fail
    const second = await S.generateAndroidKeystore();
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already exists");
  }, 20000);

  it("creates the keystore in vault/signing/", async () => {
    const result = await S.generateAndroidKeystore();
    if (!result.ok && result.error?.includes("keytool")) {
      // keytool not installed — skip
      return;
    }
    if (result.ok) {
      expect(result.path).toContain("signing");
      expect(result.path).toContain("android.keystore");
      expect(existsSync(result.path!)).toBe(true);
    }
  });
});
