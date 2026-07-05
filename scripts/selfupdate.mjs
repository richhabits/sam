// ─────────────────────────────────────────────────────────────
//  S.A.M. · self-update on launch
//  Pulls the latest SAM before it starts, so you always run the
//  newest version. Safe: only fast-forwards (never touches your
//  local edits), and skips silently if offline / not a clone /
//  you're mid-development. Disable with SAM_NO_AUTOUPDATE=1.
// ─────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";

if (process.env.SAM_NO_AUTOUPDATE === "1") process.exit(0);

const run = (cmd, opts = {}) => execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], timeout: 15000, ...opts }).toString().trim();

try {
  if (run("git rev-parse --is-inside-work-tree") !== "true") process.exit(0);   // not a clone → skip
  run("git fetch --quiet origin", { timeout: 10000 });

  const local = run("git rev-parse HEAD");
  let remote;
  try { remote = run("git rev-parse @{u}"); } catch { process.exit(0); }        // no upstream → skip
  if (local === remote) process.exit(0);                                         // already latest

  // What changed? (so we know whether deps need reinstalling)
  const changed = run(`git diff --name-only HEAD ${remote}`);

  run("git merge --ff-only @{u}", { timeout: 15000 });                           // safe: fails if you have local edits
  console.log("  ✨ SAM auto-updated to the latest version.");

  if (/package(-lock)?\.json/.test(changed)) {
    console.log("  • dependencies changed — updating…");
    execSync("npm install --silent", { stdio: "ignore", timeout: 180000 });
  }
} catch {
  // offline, local changes, or no remote — no drama, just run what we've got.
}
