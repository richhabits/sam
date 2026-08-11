// The release tooling has to work on TWO machines that store secrets differently: the operator's
// Mac (keychain profile) and a CI runner (environment variables from repository secrets). An
// earlier revision of the notarization hook understood only the keychain, which would have thrown
// on every CI macOS build — turning main red for a reason that has nothing to do with the code
// being built. These tests pin the fallback so that regression cannot come back quietly.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { notaryCredentials, isDeveloperIdSigned } from "./notary-credentials.mjs";

// A profile name that cannot exist, so resolution is forced past the keychain and onto the
// environment — the CI path — even on a machine where the real profile IS installed.
const NO_SUCH_PROFILE = "sam-test-profile-that-does-not-exist";

describe("notary credential resolution", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SAM_NOTARY_PROFILE = NO_SUCH_PROFILE;
    delete process.env.APPLE_ID;
    delete process.env.APPLE_APP_SPECIFIC_PASSWORD;
    delete process.env.APPLE_TEAM_ID;
  });
  afterEach(() => { process.env = { ...saved }; });

  it("falls back to environment credentials when there is no keychain profile (the CI path)", () => {
    process.env.APPLE_ID = "someone@example.com";
    process.env.APPLE_APP_SPECIFIC_PASSWORD = "abcd-efgh-ijkl-mnop";
    process.env.APPLE_TEAM_ID = "TEAM123456";

    const creds = notaryCredentials();
    expect(creds).not.toBeNull();
    expect(creds!.notarizeOptions).toMatchObject({
      appleId: "someone@example.com",
      appleIdPassword: "abcd-efgh-ijkl-mnop",
      teamId: "TEAM123456",
    });
    // The raw-notarytool form used for the DMG must carry the same identity, or the app and the
    // disk image would notarize as two different callers.
    expect(creds!.notarytoolArgs).toEqual(
      ["--apple-id", "someone@example.com", "--password", "abcd-efgh-ijkl-mnop", "--team-id", "TEAM123456"],
    );
  });

  it("reports nothing configured when neither route is available", () => {
    expect(notaryCredentials()).toBeNull();
  });

  it("treats partial environment credentials as unconfigured rather than half-usable", () => {
    // A half-set environment is the dangerous case: it looks configured to a human skimming the
    // workflow, and would fail deep inside an upload instead of before one.
    process.env.APPLE_ID = "someone@example.com";
    expect(notaryCredentials()).toBeNull();
    process.env.APPLE_TEAM_ID = "TEAM123456";
    expect(notaryCredentials()).toBeNull();
  });

  it("never leaks the app-specific password into the description shown in build logs", () => {
    process.env.APPLE_ID = "someone@example.com";
    process.env.APPLE_APP_SPECIFIC_PASSWORD = "abcd-efgh-ijkl-mnop";
    process.env.APPLE_TEAM_ID = "TEAM123456";
    expect(notaryCredentials()!.how).not.toContain("abcd-efgh-ijkl-mnop");
  });
});

describe("developer-id detection", () => {
  it("does not mistake an unsigned path for a signed app", () => {
    // Notarization is attempted only for signed builds; if this ever returned true for something
    // unsigned, CI's deliberate unsigned build would fail at the notarize step instead of skipping.
    expect(isDeveloperIdSigned("/tmp/sam-definitely-not-an-app-" + Date.now() + ".app")).toBe(false);
  });
});
