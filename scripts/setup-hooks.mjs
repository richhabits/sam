// Points git at our versioned hooks. Cross-platform on purpose.
//
// This was `git config core.hooksPath .githooks || true` in package.json. That works in sh, but
// npm runs scripts through cmd.exe on Windows, where `true` is not a command — so a fresh clone
// plus `npm install` failed on Windows for a reason that has nothing to do with SAM.
//
// Failure here must never block an install: the hooks are a convenience for contributors, and
// someone installing SAM shouldn't be stopped by a git config they don't care about.
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
  // Not a git checkout (npm tarball, zip download), git absent, or a read-only config.
  // All are fine — say nothing and let the install continue.
}
