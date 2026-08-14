// CONNECTORS — one dispatcher over every service SAM reads, so there is one endpoint shape, one
// row shape, and one place that knows how a service reports "I don't have a token for you".
//
// Why a dispatcher instead of five more route families: /api/github/repos was already the second
// bespoke read surface, and the fifth would have been five error mappings, five "connected?"
// probes and five list shapes for the phone and the desktop to each special-case. Everything
// here answers { rows: [{ id, title, sub, url }] }, so both UIs stay dumb and a sixth connector
// is a registry entry plus a mapper.
//
// The GitHub routes added in 4e7f307 stay exactly where they were — they are what the shipped
// phone build calls, and breaking a released client to tidy a URL is not a trade worth making.

import { ConnectorError, noToken, type Row, tokenFor } from "./connectors.http.ts";
import { CONNECTORS, type ConnectorSpec, connector, topLists } from "./connectors.registry.ts";
import { issues as ghIssues, repos as ghRepos, whoami as ghWhoami, type Issue, type Repo } from "./github.ts";
import * as slack from "./slack.ts";

/** Anything thrown in here becomes a ConnectorError, so routes have one status to read. */
export function normalize(e: any): ConnectorError {
  if (e instanceof ConnectorError) return e;
  // GitHubError predates this file and carries the same `status` field — honour it rather than
  // flattening a genuine 401 into a 502 and telling the operator GitHub is down.
  const status = Number(e?.status);
  return new ConnectorError(Number.isFinite(status) && status >= 400 ? status : 502, e?.message || "request failed");
}

const ghRepoRow = (r: Repo): Row => ({
  id: r.full,
  title: r.full,
  sub: [r.private ? "private" : null, r.language, (r.pushedAt || "").slice(0, 10)].filter(Boolean).join(" · "),
  url: r.url,
});

const ghIssueRow = (i: Issue): Row => ({
  id: String(i.number),
  title: `#${i.number} ${i.title}`.trim(),
  sub: [i.isPR ? "PR" : "issue", i.repo, (i.updatedAt || "").slice(0, 10)].filter(Boolean).join(" · "),
  url: i.url,
});

/**
 * `owner/name`, and nothing that walks. This one goes into a URL PATH (/repos/{repo}/issues)
 * rather than a query string, so a param of "x/.." would climb to a different endpoint —
 * the only place in here where the caller's string isn't safely encoded by URLSearchParams.
 */
export function safeRepo(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const parts = p.split("/");
  if (parts.length !== 2 || parts.some((s) => !/^[\w.-]+$/.test(s) || s === "." || s === "..")) {
    throw new ConnectorError(400, `"${p}" is not an owner/name repository`);
  }
  return p;
}

type Lister = (token: string, param: string | undefined, limit: number) => Promise<Row[]>;

// GitHub's readers take no token — they pull from the rotating provider pool themselves, because
// the same credential also answers as a model provider. Everything else is handed the secret.
const LISTS: Record<string, Record<string, Lister>> = {
  github: {
    repos: (_t, _p, n) => ghRepos(n).then((rs) => rs.map(ghRepoRow)),
    issues: (_t, p, n) => ghIssues(safeRepo(p), n).then((is) => is.map(ghIssueRow)),
  },
  slack: {
    channels: (t, _p, n) => slack.channels(t, n),
    messages: (t, p, n) => slack.messages(t, p || "", n),
  },
};

/** Who the credential belongs to — the connection check, and the line the UI shows under the name. */
const WHO: Record<string, (token: string) => Promise<string>> = {
  github: () => ghWhoami().then((u) => u.login),
  slack: (t) => slack.whoami(t).then((w) => [w.user, w.team].filter(Boolean).join(" · ")),
};

export interface ConnectorStatus {
  id: string;
  label: string;
  note: string;
  url: string;
  configKey?: string;
  connected: boolean;
  /** True only for "no token / bad token" — the one failure the operator can fix by pasting. */
  needsToken: boolean;
  detail?: string;
  error?: string;
  lists: { kind: string; label: string; hint: string; param?: string; drill?: string }[];
}

function listsFor(spec: ConnectorSpec) {
  return topLists(spec).map((l) => ({ kind: l.kind, label: l.label, hint: l.hint, param: l.param, drill: l.drill }));
}

async function statusOf(spec: ConnectorSpec): Promise<ConnectorStatus> {
  const base = { id: spec.id, label: spec.label, note: spec.note, url: spec.url, configKey: spec.configKey, lists: listsFor(spec) };
  const token = tokenFor(spec);
  // No token is a SETUP state, not a failure — and it needs no network call to establish.
  if (!token) return { ...base, connected: false, needsToken: true };
  try {
    return { ...base, connected: true, needsToken: false, detail: await WHO[spec.id](token) };
  } catch (e) {
    const err = normalize(e);
    return { ...base, connected: false, needsToken: err.status === 401, error: err.message };
  }
}

// Probing five services on every pane open (and the phone opens its + sheet often) is five
// round trips for an answer that changes when you paste a token, not by the second.
const TTL_MS = 30_000;
let cached: { at: number; value: ConnectorStatus[] } | null = null;

export async function statuses(opts: { refresh?: boolean } = {}): Promise<ConnectorStatus[]> {
  if (!opts.refresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await Promise.all(CONNECTORS.map(statusOf));
  cached = { at: Date.now(), value };
  return value;
}

/** Drop the memo — called after a token is saved, so Settings reflects the paste immediately. */
export function forgetStatuses(): void {
  cached = null;
}

/** One list from one connector, as rows. Throws ConnectorError; routes map `.status`. */
export async function list(id: string, kind: string, opts: { param?: string; limit?: number } = {}): Promise<Row[]> {
  const spec = connector(id);
  if (!spec) throw new ConnectorError(404, `no connector called "${id}"`);
  const lister = LISTS[id]?.[kind];
  if (!lister) throw new ConnectorError(404, `${spec.label} has no list called "${kind}"`);
  const token = tokenFor(spec);
  if (!token) throw noToken(spec.label);
  try {
    return await lister(token, opts.param, opts.limit ?? 30);
  } catch (e) {
    throw normalize(e);
  }
}
