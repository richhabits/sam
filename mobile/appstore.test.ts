import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The App Store rules SAM's iOS config has to keep satisfying, pinned so a later edit to
// app.json cannot quietly undo them. None of this is caught by a build — an app with a missing
// usage string or a too-broad transport-security exemption compiles, installs, runs, and is
// found out at review, which is the slowest possible feedback loop.
const app = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app.json"), "utf8"),
).expo;
const plist = app.ios.infoPlist;

describe("App Transport Security", () => {
  it("exempts LOCAL networking only — never the whole internet", () => {
    // NSAllowsArbitraryLoads turns ATS off for every host on earth. App Review asks you to
    // justify it, and "we talk to a server on your desk" does not justify a global exemption —
    // NSAllowsLocalNetworking is the narrow key for exactly that and needs no justification.
    // Every fetch in this app goes to the operator's own SAM or a local file URI; the one
    // outbound link opens Safari, which ATS does not govern. So the broad key bought nothing.
    expect(plist.NSAppTransportSecurity.NSAllowsLocalNetworking).toBe(true);
    expect(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads).toBeUndefined();
  });

  it("does not carry the other blanket escape hatches either", () => {
    // The same exemption wearing different hats — each one is its own review question.
    expect(plist.NSAppTransportSecurity.NSAllowsArbitraryLoadsInWebContent).toBeUndefined();
    expect(plist.NSAppTransportSecurity.NSAllowsArbitraryLoadsForMedia).toBeUndefined();
    expect(plist.NSAppTransportSecurity.NSExceptionDomains).toBeUndefined();
  });
});

describe("permission prompts iOS refuses to show without a reason string", () => {
  // A missing string is not a warning — the API returns nothing, or the app is terminated.
  // Required since iOS 14 for anything touching the local network, which is ALL this app does.
  it.each([
    ["NSLocalNetworkUsageDescription", "reaching SAM on the operator's own machine"],
    ["NSCameraUsageDescription", "attaching a photo"],
    ["NSPhotoLibraryUsageDescription", "picking a photo"],
  ])("%s is present and says something specific", (key) => {
    const s = plist[key];
    expect(typeof s).toBe("string");
    // Apple rejects boilerplate that does not say what the app does with the access.
    expect(s.length).toBeGreaterThan(40);
    expect(s.toLowerCase()).toContain("sam");
  });
});

describe("privacy manifest", () => {
  const pm = app.ios.privacyManifests;

  it("declares no tracking and no collected data — which is the truth for a local-first app", () => {
    expect(pm.NSPrivacyTracking).toBe(false);
    expect(pm.NSPrivacyCollectedDataTypes).toEqual([]);
  });

  it("declares a reason for every required-reason API it uses", () => {
    // Missing or invalid reason codes bounce at upload as ITMS-91053, not at review.
    const types = pm.NSPrivacyAccessedAPITypes;
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) {
      expect(t.NSPrivacyAccessedAPIType).toMatch(/^NSPrivacyAccessedAPICategory/);
      expect(t.NSPrivacyAccessedAPITypeReasons.length).toBeGreaterThan(0);
      // Apple's codes are four alphanumerics, a dot, then a digit — e.g. CA92.1.
      for (const r of t.NSPrivacyAccessedAPITypeReasons) expect(r).toMatch(/^[A-Z0-9]{4}\.\d+$/);
    }
  });
});

describe("submission metadata", () => {
  it("declares export compliance, so uploads do not stall waiting on the encryption question", () => {
    expect(plist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it("has a bundle id, a scheme and a build number", () => {
    expect(app.ios.bundleIdentifier).toBe("com.hectic.sam.mobile");
    // The pairing QR is a sam:// link — without the scheme registered, the Camera app has
    // nothing to offer to open and the whole pairing on-ramp disappears.
    expect(app.scheme).toBe("sam");
    expect(String(app.ios.buildNumber)).toMatch(/^\d+$/);
  });

  it("declares Android package name, version code and camera permissions for Android parity", () => {
    expect(app.android.package).toBe("com.hectic.sam.mobile");
    expect(typeof app.android.versionCode).toBe("number");
    expect(app.android.permissions).toContain("CAMERA");
    expect(app.android.permissions).toContain("INTERNET");
  });
});

describe("signing the widget, which only fails away from Xcode.app", () => {
  // Archiving from the command line died on "Signing for SAMWidget requires a development team".
  // The widget target set CODE_SIGN_STYLE=Automatic and no DEVELOPMENT_TEAM, which Xcode.app
  // papers over using whoever is signed in — so the GUI archives cleanly and nothing reveals the
  // gap until something without an Apple account tries to build it. CI is exactly that something.
  const widgetPlugin = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "plugins", "with-ios-widget.js"),
    "utf8",
  );

  it("declares the team once, in config", () => {
    expect(app.ios.appleTeamId).toMatch(/^[A-Z0-9]{10}$/);
  });

  it("hands that team to the widget target rather than restating it", () => {
    // A literal team id here would be a second place for it to be wrong, exactly as a literal
    // version was before CURRENT_PROJECT_VERSION started reading the app's own.
    expect(widgetPlugin).toContain("DEVELOPMENT_TEAM");
    expect(widgetPlugin).toContain("cfg.ios?.appleTeamId");
    expect(widgetPlugin).not.toContain(`DEVELOPMENT_TEAM: "${app.ios.appleTeamId}"`);
  });
});
