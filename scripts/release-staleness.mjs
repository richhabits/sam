// ─────────────────────────────────────────────────────────────
//  S.A.M. · release staleness — is real work sitting on main that no installed
//  app has received yet? Born from a real incident: two weeks of verified fixes
//  (yard concurrency, the SSRF guard, mobile's Android bring-up) shipped to main
//  and sat there silently — nobody was told, so nobody cut a release.
//
//  This only NAGS (files/updates a labeled GitHub issue via the workflow that
//  calls it). It never cuts a release itself — that stays a human act, same as
//  every other "tell the maintainer instead of rotting silently" watchdog here.
// ─────────────────────────────────────────────────────────────
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DAY_THRESHOLD = 7;
const COMMIT_THRESHOLD = 5;

// Non-user-facing commit prefixes don't count toward "user-visible" — a run of
// `chore: sync stats` commits shouldn't itself trigger the nag.
const NOISE_PREFIX = /^(chore|docs|ci|test|style)(\(|:)/i;

export function isStale(days, userVisibleCommits, dayThreshold = DAY_THRESHOLD, commitThreshold = COMMIT_THRESHOLD) {
  return days >= dayThreshold && userVisibleCommits >= commitThreshold;
}

export function computeStaleness(run = (c) => execSync(c, { encoding: "utf8" }).trim()) {
  const tag = run("git describe --tags --abbrev=0");
  const tagEpoch = Number(run(`git log -1 --format=%ct ${tag}`));
  const days = Math.floor((Date.now() / 1000 - tagEpoch) / 86400);
  const subjects = run(`git log ${tag}..HEAD --format=%s`).split("\n").filter(Boolean);
  const userVisibleCommits = subjects.filter((s) => !NOISE_PREFIX.test(s)).length;
  return { tag, days, totalCommits: subjects.length, userVisibleCommits, stale: isStale(days, userVisibleCommits) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(computeStaleness()));
}
