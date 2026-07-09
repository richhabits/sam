// ─────────────────────────────────────────────────────────────
//  S.A.M. · ROLLBACK  (v1.5 Phase 2)
//
//  If an update breaks something, drop back to the previous release. We find
//  the release immediately before the current version on GitHub and hand back
//  the right installer asset for THIS platform, so `sam rollback` (or the
//  Settings button) can reinstall it. Non-destructive: your vault/data stays.
// ─────────────────────────────────────────────────────────────

const REPO = "https://api.github.com/repos/richhabits/sam/releases";

interface Rel { tag_name: string; prerelease: boolean; draft: boolean; html_url: string; assets: { name: string; browser_download_url: string }[] }

function cmp(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.replace(/^v/, "").split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

// Match the installer asset for the current OS (mac .dmg, win .exe, linux .AppImage).
function assetFor(rel: Rel): { name: string; url: string } | null {
  const want = process.platform === "darwin" ? /\.dmg$/i : process.platform === "win32" ? /\.exe$/i : /\.AppImage$/i;
  const a = rel.assets?.find((x) => want.test(x.name));
  return a ? { name: a.name, url: a.browser_download_url } : null;
}

export interface RollbackTarget { version: string; releaseUrl: string; asset: { name: string; url: string } | null }

// The newest release strictly OLDER than `current` (skips drafts; includes betas only if on beta).
export async function previousRelease(current: string, includePrerelease = false): Promise<RollbackTarget | null> {
  try {
    const res = await fetch(`${REPO}?per_page=30`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "SAM-app" } });
    if (!res.ok) return null;
    const rels = (await res.json() as Rel[])
      .filter((r) => !r.draft && (includePrerelease || !r.prerelease) && cmp(r.tag_name, current) < 0)
      .sort((a, b) => cmp(b.tag_name, a.tag_name));
    const prev = rels[0];
    if (!prev) return null;
    return { version: prev.tag_name.replace(/^v/, ""), releaseUrl: prev.html_url, asset: assetFor(prev) };
  } catch { return null; }
}
