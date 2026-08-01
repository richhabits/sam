import { getKey } from "./keys.ts";

// GITHUB — read your own work without leaving SAM.
//
// No new credential: SAM already carries a GitHub token, because "GitHub Models" is a
// provider in providers.registry.ts (GITHUB_TOKEN, ghp_/github_pat_). Inventing a second
// place to paste the same token is how a settings screen ends up with two GitHub rows that
// disagree — so this reads the pooled one.
//
// READ-ONLY on purpose. Listing repos and issues is a different act from pushing, merging or
// closing, and this is reachable from a paired phone. Anything that writes to a repo should
// be a deliberate, separately-granted decision (see the "approve" grant for the shape that
// would take), not something that arrives quietly with a read feature.

const API = "https://api.github.com";
// GitHub is not on the critical path of a chat turn, but `fetch` still has no default
// timeout — the same trap embeddings had, where a black-holed socket hangs forever.
const TIMEOUT_MS = Number(process.env.SAM_GITHUB_TIMEOUT_MS) || 15_000;

export type Repo = { name: string; full: string; private: boolean; description: string | null; pushedAt: string | null; language: string | null; url: string };
export type Issue = { number: number; title: string; state: string; repo: string; isPR: boolean; updatedAt: string | null; url: string };

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function gh(path: string): Promise<any> {
  const token = getKey("github");
  // A missing token is a setup state, not a failure — the caller turns this into "connect
  // GitHub", never into an error that looks like GitHub is down.
  if (!token) throw new GitHubError(401, "no GitHub token — add one in SAM's keys panel");

  const r = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // GitHub rejects requests with no User-Agent outright.
      "User-Agent": "SAM",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (r.status === 401) throw new GitHubError(401, "that GitHub token was rejected — it may have expired");
  if (r.status === 403) throw new GitHubError(403, "GitHub refused: rate limit, or the token is missing the `repo` scope");
  if (!r.ok) throw new GitHubError(r.status, `GitHub returned ${r.status}`);
  return r.json();
}

/** Who the token belongs to. Doubles as the connection check. */
export async function whoami(): Promise<{ login: string; name: string | null }> {
  const u = await gh("/user");
  return { login: String(u?.login || ""), name: u?.name ?? null };
}

/** Shape one API repo into the little SAM actually shows. Pure, so it can be tested. */
export function toRepo(r: any): Repo {
  return {
    name: String(r?.name || ""),
    full: String(r?.full_name || ""),
    private: !!r?.private,
    description: r?.description ?? null,
    pushedAt: r?.pushed_at ?? null,
    language: r?.language ?? null,
    url: String(r?.html_url || ""),
  };
}

/** Your repos, most recently pushed first — the order you actually think about them in. */
export async function repos(limit = 30): Promise<Repo[]> {
  const list = await gh(`/user/repos?sort=pushed&per_page=${Math.min(Math.max(limit, 1), 100)}`);
  return Array.isArray(list) ? list.map(toRepo) : [];
}

/** Shape one issue/PR. GitHub returns PRs from the issues endpoint; keep the distinction. */
export function toIssue(i: any, repoFull?: string): Issue {
  return {
    number: Number(i?.number || 0),
    title: String(i?.title || ""),
    state: String(i?.state || ""),
    repo: String(i?.repository?.full_name || repoFull || ""),
    isPR: !!i?.pull_request,
    updatedAt: i?.updated_at ?? null,
    url: String(i?.html_url || ""),
  };
}

/**
 * Open issues and PRs assigned to you, or for one repo if given. Assigned-to-you is the
 * default because "what needs me" is the question worth answering on a phone.
 */
export async function issues(repo?: string, limit = 30): Promise<Issue[]> {
  const per = Math.min(Math.max(limit, 1), 100);
  if (repo) {
    const list = await gh(`/repos/${repo}/issues?state=open&per_page=${per}`);
    return Array.isArray(list) ? list.map((i) => toIssue(i, repo)) : [];
  }
  try {
    const list = await gh(`/issues?filter=assigned&state=open&per_page=${per}`);
    return Array.isArray(list) ? list.map((i) => toIssue(i)) : [];
  } catch (e: any) {
    // A FINE-GRAINED token (github_pat_…) does not support the cross-repo /issues endpoint and
    // answers 404 — which reads as "you have no issues" rather than "this token cannot ask
    // that question". The search API answers the same question and fine-grained tokens can
    // use it, so fall through rather than showing an empty list that is quietly a lie.
    if (!(e instanceof GitHubError) || e.status !== 404) throw e;
    const found = await gh(`/search/issues?q=${encodeURIComponent("assignee:@me state:open")}&per_page=${per}`);
    const items = Array.isArray(found?.items) ? found.items : [];
    return items.map((i: any) => toIssue({
      ...i,
      // search results carry the repo only inside repository_url
      repository: { full_name: String(i?.repository_url || "").split("/repos/")[1] || "" },
    }));
  }
}
