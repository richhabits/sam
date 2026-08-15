// LINEAR — the issues assigned to you, and your teams.
//
// LINEAR_API_KEY was the other Settings field read by nothing. Read-only: listing what is
// waiting on you is a different act from moving it, and moving someone else's issue from a
// phone with no confirmation is exactly the kind of quiet write this codebase keeps out.

import { ConnectorError, callJson, cap, day, type Row, sub } from "./connectors.http.ts";

const API = "https://api.linear.app/graphql";

async function gql(token: string, query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const j = await callJson(API, {
    label: "Linear",
    method: "POST",
    // A PERSONAL api key goes in Authorization RAW — no "Bearer". Bearer is the OAuth form, and
    // sending it with a lin_api_ key is rejected as unauthenticated, which reads as a bad key.
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  // GraphQL reports failure in the BODY at HTTP 200, so nothing upstream can map it.
  if (Array.isArray(j?.errors) && j.errors.length) throw linearError(j.errors);
  return j?.data;
}

export function linearError(errors: any[]): ConnectorError {
  const msg = String(errors[0]?.message || "request failed");
  const code = String(errors[0]?.extensions?.code || "");
  if (/authenticat|unauthorized|invalid api key/i.test(`${msg} ${code}`)) {
    return new ConnectorError(401, "Linear rejected that API key");
  }
  return new ConnectorError(502, `Linear said: ${msg}`);
}

/** Who the key belongs to. Doubles as the connection check. */
export async function whoami(token: string): Promise<{ name: string; email: string }> {
  const d = await gql(token, "{ viewer { name email } }");
  return { name: String(d?.viewer?.name || ""), email: String(d?.viewer?.email || "") };
}

export function toIssue(i: any): Row {
  return {
    id: String(i?.id || i?.identifier || ""),
    title: sub(i?.identifier, i?.title) || "(untitled)",
    sub: sub(i?.state?.name, i?.team?.key, day(i?.updatedAt)),
    url: String(i?.url || ""),
  };
}

/** Open issues assigned to you — "what needs me", the question worth answering on a phone. */
export async function issues(token: string, limit = 30): Promise<Row[]> {
  const d = await gql(
    token,
    `query($n: Int!) { viewer { assignedIssues(first: $n, filter: { completedAt: { null: true }, canceledAt: { null: true } }) {
       nodes { id identifier title url updatedAt state { name } team { key } } } } }`,
    { n: cap(limit, 100) },
  );
  const nodes = d?.viewer?.assignedIssues?.nodes;
  return Array.isArray(nodes) ? nodes.map(toIssue) : [];
}

export function toTeam(t: any): Row {
  return { id: String(t?.id || ""), title: String(t?.name || "team"), sub: sub(t?.key, t?.description || null) };
}

export async function teams(token: string, limit = 30): Promise<Row[]> {
  const d = await gql(token, "query($n: Int!) { teams(first: $n) { nodes { id key name description } } }", { n: cap(limit, 100) });
  const nodes = d?.teams?.nodes;
  return Array.isArray(nodes) ? nodes.map(toTeam) : [];
}
