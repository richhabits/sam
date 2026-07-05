// ─────────────────────────────────────────────────────────────
//  S.A.M. · ship  — the dream flow: one command, test → build →
//  commit → push. It lands on GitHub, and every user auto-updates
//  on their next launch. Authored as HECTIC (no personal info).
//  Usage:  npm run ship "what you changed"
// ─────────────────────────────────────────────────────────────

import { execSync } from "node:child_process";

const msg = process.argv.slice(2).join(" ").trim() || "update";
const run = (c, opts = {}) => execSync(c, { stdio: "inherit", ...opts });
const quiet = (c) => execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

try {
  if (!quiet("git status --porcelain")) { console.log("Nothing to ship — no changes."); process.exit(0); }

  console.log("\n🧪 testing…");   run("npm test");
  console.log("\n🎨 refreshing landing…"); run("node scripts/gen-landing.mjs");
  console.log("\n🏗️  building…");  run("npm run build");

  console.log("\n🚀 shipping…");
  run("git add -A");
  run(`git -c user.name=HECTIC -c user.email=richhabits@users.noreply.github.com commit -m ${JSON.stringify(msg)}`);
  run("git push");

  console.log("\n✅ Shipped to GitHub. Every user gets it automatically on next launch. 🔄\n");
} catch (e) {
  console.error("\n✗ Ship stopped (nothing pushed). Fix the above and run again.\n");
  process.exit(1);
}
