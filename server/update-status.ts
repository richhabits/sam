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
