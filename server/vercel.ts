// VERCEL — your projects, and whether the last deploy actually succeeded.
//
// VERCEL_TOKEN already exists: the yard injects it into deploy jobs (server/yard/deploy.ts).
// This reads with it. The reason it earns a place next to Slack and Notion is that "the push
// went through, so the site is live" is a false inference — a deployment can sit in ERROR while
// the domain keeps serving an old build and answering 200. This surfaces the state itself.

import { callJson, cap, day, type Row, sub } from "./connectors.http.ts";

const API = "https://api.vercel.com";

function headers(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Whose account. Doubles as the connection check. */
export async function whoami(token: string): Promise<{ username: string }> {
  const j = await callJson(`${API}/v2/user`, { label: "Vercel", headers: headers(token) });
  return { username: String(j?.user?.username || j?.user?.email || "") };
}

export function toProject(p: any): Row {
  const latest = Array.isArray(p?.latestDeployments) ? p.latestDeployments[0] : null;
  return {
    id: String(p?.id || ""),
    title: String(p?.name || "project"),
    sub: sub(p?.framework || null, latest?.readyState ? String(latest.readyState).toLowerCase() : null, day(msToIso(p?.updatedAt))),
    // No dashboard link: that URL needs the team slug, which the project object doesn't carry —
    // and a link that 404s is worse than no link. The latest deployment below has a real one.
    url: latest?.url ? `https://${latest.url}` : "",
  };
}

/** ms-epoch → ISO. Vercel dates are numbers, and day() wants a string. */
function msToIso(ms: unknown): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : "";
}

export async function projects(token: string, limit = 30): Promise<Row[]> {
  const j = await callJson(`${API}/v9/projects?limit=${cap(limit, 100)}`, { label: "Vercel", headers: headers(token) });
  const list = Array.isArray(j?.projects) ? j.projects : [];
  return list.map(toProject);
}

export function toDeployment(d: any): Row {
  // `state` and `readyState` are the same value under two names depending on API version; a
  // deployment with neither is reported as unknown rather than silently as a success.
  const state = String(d?.state || d?.readyState || "unknown").toLowerCase();
  return {
    id: String(d?.uid || d?.id || ""),
    title: String(d?.name || "deployment"),
    sub: sub(state, d?.target || "preview", day(msToIso(d?.created ?? d?.createdAt))),
    url: d?.url ? `https://${d.url}` : "",
  };
}

/** Newest first. `?param=` narrows to one project by name, which is how you check one site. */
export async function deployments(token: string, project?: string, limit = 30): Promise<Row[]> {
  const q = new URLSearchParams({ limit: String(cap(limit, 100)) });
  if (project) q.set("app", project);
  const j = await callJson(`${API}/v6/deployments?${q}`, { label: "Vercel", headers: headers(token) });
  const list = Array.isArray(j?.deployments) ? j.deployments : [];
  return list.map(toDeployment);
}
