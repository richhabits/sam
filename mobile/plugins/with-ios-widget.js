const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

// Why this plugin exists
// ──────────────────────
// `ios/` is generated and gitignored. A WidgetKit extension is a SECOND Xcode target, and a
// second target is something you normally add by clicking through Xcode's template — which
// writes straight into `ios/`, i.e. into a directory the next `expo prebuild --clean` deletes.
// A widget added that way survives exactly until the next dependency bump and then vanishes,
// silently, in a build nobody looks at.
//
// So the target is declared HERE instead: the Swift and the Info.plist live in tracked
// `widget/`, and this plugin copies them in and wires up the target on every prebuild. Nothing
// in `ios/` is authored by hand, and `expo prebuild --platform ios --clean` reproduces the
// whole thing from scratch.
//
// What it deliberately does NOT do
// ────────────────────────────────
// No App Group, no shared container, no entitlements. Sharing live data with a widget needs an
// App Group identifier registered on a paid Apple Developer account and an entitlement on BOTH
// targets — which would make `expo prebuild` produce a project that no longer builds for
// anyone who hasn't done that registration, in exchange for data the widget can't get anyway
// (the pairing token is in the Keychain and the Mac is on the LAN). The widget is a launcher;
// it deep-links into the app over the `sam` scheme the app already registers. docs/WIDGETS.md
// records what the App Group step would cost when someone wants it.

const TARGET = 'SAMWidget';
// The extension's identifier must be a suffix of the app's — Apple requires an app extension's
// bundle id to be prefixed by its container app's, and rejects the build otherwise.
const BUNDLE_SUFFIX = '.widget';
// What Xcode's own template calls the phase that puts the .appex inside the .app.
const EMBED_PHASE = 'Embed Foundation Extensions';
// Lock Screen (accessory) families are iOS 16.0. The app's own floor is higher today, but
// clamping here means a future drop in the app's target can't quietly produce a widget that
// won't compile.
const MIN_IOS = 16.0;

/** Source of truth for the widget, in tracked code rather than in generated `ios/`. */
const SOURCE_DIR = path.join(__dirname, '..', 'widget');
const SOURCES = ['SAMWidget.swift'];
const PLIST = 'Info.plist';

/** Copy the tracked widget sources into the generated project, replacing whatever was there.
 *  Dangerous mods run before the .pbxproj mod, so the files exist by the time it references
 *  them — the same ordering with-space-safe-pods relies on for the Podfile. */
function copySources(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const dest = path.join(cfg.modRequest.platformProjectRoot, TARGET);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      for (const name of [...SOURCES, PLIST]) {
        fs.copyFileSync(path.join(SOURCE_DIR, name), path.join(dest, name));
      }
      return cfg;
    },
  ]);
}

/** Set build settings on exactly one target, by walking its own configuration list. The
 *  library's updateBuildProperty() matches targets by their pbxproj *comment*, which is quoted
 *  for targets it added and unquoted for the ones the Expo template ships — a difference that
 *  silently writes settings onto the wrong target, or onto every target. This doesn't guess. */
function setBuildSettings(proj, targetUuid, settings) {
  const nativeTargets = proj.pbxNativeTargetSection();
  const listUuid = nativeTargets[targetUuid].buildConfigurationList;
  const configs = proj.pbxXCConfigurationList()[listUuid].buildConfigurations;
  const section = proj.pbxXCBuildConfigurationSection();
  for (const { value } of configs) {
    Object.assign(section[value].buildSettings, settings);
  }
}

/** The app target's deployment floor, so the extension tracks the app instead of drifting from
 *  it. Read from the generated project rather than restated, because restating it is how the
 *  two end up disagreeing. */
function deploymentTarget(proj) {
  const section = proj.pbxXCBuildConfigurationSection();
  let lowest = null;
  for (const key of Object.keys(section)) {
    const value = section[key];
    if (!value || typeof value !== 'object') continue;
    const raw = value.buildSettings && value.buildSettings.IPHONEOS_DEPLOYMENT_TARGET;
    const n = Number(String(raw ?? '').replace(/"/g, ''));
    if (!Number.isFinite(n) || n <= 0) continue;
    if (lowest === null || n < lowest) lowest = n;
  }
  return String(Math.max(lowest ?? MIN_IOS, MIN_IOS));
}

function addWidgetTarget(config) {
  return withXcodeProject(config, (cfg) => {
    const proj = cfg.modResults;
    const appName = cfg.modRequest.projectName;
    const bundleId = cfg.ios && cfg.ios.bundleIdentifier;
    if (!bundleId) {
      throw new Error('[with-ios-widget] ios.bundleIdentifier is not set — the widget cannot be named.');
    }

    // Idempotent: prebuild without --clean re-runs every mod over a project that already has
    // the target, and a second copy would produce two extensions with the same bundle id.
    const nativeTargets = proj.pbxNativeTargetSection();
    for (const key of Object.keys(nativeTargets)) {
      const t = nativeTargets[key];
      if (t && typeof t === 'object' && String(t.name || '').replace(/"/g, '') === TARGET) return cfg;
    }

    // addTarget() hangs the "Embed App Extensions" copy phase and the build dependency off
    // getFirstTarget(). If that ever stops being the app, the extension would be embedded in
    // the wrong product and simply never appear on the phone — a failure with no error. Check.
    const first = proj.getFirstTarget();
    if (String(first.firstTarget.name || '').replace(/"/g, '') !== appName) {
      throw new Error(
        `[with-ios-widget] expected "${appName}" to be the first Xcode target, found ` +
          `"${first.firstTarget.name}". The widget would be embedded in the wrong product.`,
      );
    }

    // addTarget() ends by making the app depend on the extension — but its addTargetDependency()
    // writes into the PBXTargetDependency / PBXContainerItemProxy sections ONLY IF THEY ALREADY
    // EXIST, and returns quietly when they don't. The Expo template has a single target, so it
    // ships neither section, and the dependency is dropped without a word. The result builds
    // most of the time and then intermittently fails to find SAMWidget.appex when Xcode happens
    // to schedule the embed before the extension — the worst kind of bug. Create the sections
    // first so the dependency actually lands, and assert below that it did.
    for (const section of ['PBXTargetDependency', 'PBXContainerItemProxy']) {
      if (!proj.hash.project.objects[section]) proj.hash.project.objects[section] = {};
    }

    const target = proj.addTarget(TARGET, 'app_extension', TARGET, `${bundleId}${BUNDLE_SUFFIX}`);

    if (!(nativeTargets[first.uuid].dependencies || []).length) {
      throw new Error(
        '[with-ios-widget] the app target ended up with no dependency on the widget — it would ' +
          'be embedded before it is built. The xcode library\'s addTargetDependency() changed shape.',
      );
    }

    // addTarget() calls the embed phase "Copy Files", which in Xcode's own project navigator is
    // indistinguishable from any other copy step. Name it what it is.
    const copyPhases = proj.hash.project.objects.PBXCopyFilesBuildPhase || {};
    for (const key of Object.keys(copyPhases)) {
      if (key.endsWith('_comment')) {
        if (copyPhases[key] === 'Copy Files') copyPhases[key] = EMBED_PHASE;
      } else if (copyPhases[key] && copyPhases[key].name === '"Copy Files"') {
        copyPhases[key].name = `"${EMBED_PHASE}"`;
      }
    }
    for (const phase of nativeTargets[first.uuid].buildPhases || []) {
      if (phase.comment === 'Copy Files') phase.comment = EMBED_PHASE;
    }

    // A target with no phases compiles nothing. Sources carries the Swift; Frameworks is empty
    // on purpose — Swift emits autolink records for WidgetKit and SwiftUI from the `import`
    // itself, so listing them again would only be decoration that can go stale.
    proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
    proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
    proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);

    // A group with a name but no path, so its children carry `SAMWidget/…` paths — the shape
    // the Expo template already uses for the app's own group, rather than a second convention.
    const group = proj.pbxCreateGroup(TARGET);
    const mainGroup = proj.getFirstProject().firstProject.mainGroup;
    proj.getPBXGroupByKey(mainGroup).children.push({ value: group, comment: TARGET });

    for (const name of SOURCES) {
      proj.addSourceFile(`${TARGET}/${name}`, { target: target.uuid }, group);
    }
    // The Info.plist is referenced by INFOPLIST_FILE, never compiled — adding it to a build
    // phase would copy it into the bundle a second time and Xcode warns about exactly that.
    proj.addFile(`${TARGET}/${PLIST}`, group, { lastKnownFileType: 'text.plist.xml' });

    const deployment = deploymentTarget(proj);
    setBuildSettings(proj, target.uuid, {
      ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME: '""',
      CLANG_ENABLE_MODULES: 'YES',
      CODE_SIGN_STYLE: 'Automatic',
      CURRENT_PROJECT_VERSION: '1',
      // The plist in widget/ is complete and hand-owned; letting Xcode synthesise a second one
      // and merge them is how NSExtension keys end up half-present.
      GENERATE_INFOPLIST_FILE: 'NO',
      INFOPLIST_FILE: `${TARGET}/${PLIST}`,
      IPHONEOS_DEPLOYMENT_TARGET: deployment,
      LD_RUNPATH_SEARCH_PATHS: '"$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks"',
      MARKETING_VERSION: '1.0',
      MTL_FAST_MATH: 'YES',
      PRODUCT_BUNDLE_IDENTIFIER: `"${bundleId}${BUNDLE_SUFFIX}"`,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SKIP_INSTALL: 'YES',
      SWIFT_EMIT_LOC_STRINGS: 'YES',
      SWIFT_VERSION: '5.0',
      // iPhone and iPad, matching the app's supportsTablet.
      TARGETED_DEVICE_FAMILY: '"1,2"',
    });

    return cfg;
  });
}

module.exports = function withIosWidget(config) {
  return addWidgetTarget(copySources(config));
};
