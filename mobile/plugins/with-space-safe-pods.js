const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

// Why this plugin exists
// ──────────────────────
// This repo lives at "/Volumes/Work Drive/SAM" — a path with a SPACE in it. Several CocoaPods
// script phases interpolate their path into a shell command without quoting it, e.g.
// expo-constants ships:
//
//     bash -l -c "$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh"
//
// Xcode expands $PODS_TARGET_SRCROOT inside those double quotes, hands the result to
// `bash -c`, and bash word-splits it at the space. The build then dies with:
//
//     No such file or directory: /Volumes/Work
//
// which reads like a missing file and is actually a quoting bug. It cost a full debugging
// session on PIING before, for the same reason on the same drive, so it is fixed HERE, in
// tracked code, rather than by hand in ios/ (which is generated and gitignored) or by
// renaming the volume (which would break every other checkout on it).
//
// A symlink from a space-free path does NOT work: CocoaPods resolves realpath when it writes
// Pods.xcodeproj, so the space comes straight back. The fix has to be the quoting itself.
//
// Runs as a dangerous mod because the Podfile is a generated template, not structured config;
// prebuild regenerates it every time, and this re-applies immediately after, before the
// `pod install` at the end of prebuild reads it.

const MARKER = '# space-safe-paths (plugins/with-space-safe-pods.js)';

const PATCH = `    ${MARKER}
    # Quote every script phase that drops an unquoted pod path into a shell command, so a
    # directory with a space in it survives. Idempotent: skips anything already quoted.
    installer.pods_project.targets.each do |t|
      t.build_phases.each do |ph|
        next unless ph.respond_to?(:shell_script) && ph.shell_script
        patched = ph.shell_script.gsub('"$PODS_TARGET_SRCROOT/', %q{"'$PODS_TARGET_SRCROOT'/})
        ph.shell_script = patched if patched != ph.shell_script
      end
    end
`;

// The APP target has the same bug in its own "Bundle React Native code and images" phase,
// whose last line is a bare backtick substitution:
//
//     `"$NODE_BINARY" --print "…react-native-xcode.sh"`
//
// The backticks run whatever that prints AS A COMMAND, unquoted — so the printed path
// "/Volumes/Work HQ/…/react-native-xcode.sh" splits and the shell tries to execute
// "/Volumes/Work". Same fix: capture it, then invoke it quoted. Matched on the escaped text
// exactly as the pbxproj stores it.
const RN_BACKTICK =
  '`\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'\\"`';
const RN_QUOTED =
  'REACT_NATIVE_XCODE_SH=\\"$(\\"$NODE_BINARY\\" --print \\"require(\'path\').dirname(require.resolve(\'react-native/package.json\')) + \'/scripts/react-native-xcode.sh\'\\")\\"\\n' +
  '/bin/sh \\"$REACT_NATIVE_XCODE_SH\\"';

function patchAppProject(config) {
  return withXcodeProject(config, (cfg) => {
    const phases = cfg.modResults.hash.project.objects.PBXShellScriptBuildPhase || {};
    let patched = 0;
    for (const key of Object.keys(phases)) {
      const phase = phases[key];
      if (!phase || typeof phase !== 'object' || !phase.shellScript) continue;
      if (!phase.shellScript.includes(RN_BACKTICK)) continue;
      phase.shellScript = phase.shellScript.split(RN_BACKTICK).join(RN_QUOTED);
      patched++;
    }
    // Fail loudly rather than build a binary that dies later with a baffling
    // "/Volumes/Work: No such file or directory" — if the template's wording changed, the
    // quoting needs re-deriving, and silence here would just reproduce the original bug.
    if (patched === 0) {
      throw new Error(
        '[with-space-safe-pods] the React Native bundle phase no longer matches the pattern ' +
          'this plugin quotes. Re-check ios/*.xcodeproj before building from a path with spaces.',
      );
    }
    return cfg;
  });
}

module.exports = function withSpaceSafePods(config) {
  return patchAppProject(withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const src = fs.readFileSync(podfile, 'utf8');
      if (src.includes(MARKER)) return cfg;

      // Append inside the EXISTING post_install block rather than declaring a second one —
      // CocoaPods keeps only the last post_install per target definition, so a second block
      // would silently drop react_native_post_install and break the build in a new way.
      const anchor = 'post_install do |installer|\n';
      const at = src.indexOf(anchor);
      if (at === -1) {
        throw new Error(
          '[with-space-safe-pods] no post_install block in the generated Podfile — the Expo ' +
            'template changed shape. Re-check the quoting fix before building on a path with spaces.',
        );
      }
      const out = src.slice(0, at + anchor.length) + PATCH + src.slice(at + anchor.length);
      fs.writeFileSync(podfile, out);
      return cfg;
    },
  ]));
};
