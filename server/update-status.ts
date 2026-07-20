// Pure helpers for the update popover. Kept out of index.ts so they're importable by tests
// without booting the whole server. The rule they encode: SAM always tells the user a real
// version number ("SAM 2.2.0") — never a bare git SHA, which means nothing to a human.

export interface UpdateStatus { behind: boolean; current?: string; latest?: string; url?: string }

// Semver "a newer than b" — used to decide the packaged-app update banner.
export const isNewerVer = (a: string, b: string): boolean => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x > y; }
  return false;
};

// Source install (git checkout): "behind" is decided by SHA, but what we SHOW the user is the
// human version. When behind we surface the short remote SHA as `latest` (there's no newer version
// number in a same-branch checkout); otherwise both current and latest are the running version.
export function sourceUpdateStatus(version: string, localSha: string, remoteSha: string): UpdateStatus {
  const behind = !!remoteSha && remoteSha !== localSha;
  const current = version || localSha.slice(0, 7) || undefined;
  return { behind, current, latest: behind ? remoteSha.slice(0, 7) : (version || undefined) };
}

// Turn a raw `git pull` failure into a sentence a normal user can act on. A user should NEVER see
// git's own "no tracking information / git pull <remote> <branch>" wall of text — that leaked once
// when the checkout sat on a local branch with no upstream.
export function friendlyUpdateError(raw: string): string {
  const msg = (raw || "").toString();
  if (/not a git repository/i.test(msg)) return "This isn't a source checkout — download the latest app from the releases page instead.";
  if (/no tracking information|no upstream|specify which branch/i.test(msg)) return "SAM's copy isn't tracking the update branch. In the sam folder run `git checkout main` (then `git branch --set-upstream-to=origin/main main`), or reinstall from the releases page.";
  if (/diverged|non-fast-forward|would be overwritten|Not possible to fast-forward/i.test(msg)) return "Your copy has diverged from GitHub. Run `git pull` in the sam folder to reconcile, or reinstall the app.";
  if (/could not resolve host|network|timed out/i.test(msg)) return "Couldn't reach GitHub — check your internet and try again.";
  return msg.slice(0, 200);
}
