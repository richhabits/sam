// SLACK — read your workspace. Channels, and what was last said in one.
//
// The token is SLACK_BOT_TOKEN, which SAM already had a Settings field for and already used to
// POST with (tools.ts, the "broadcast" tool). This adds the reading half; it does not add a
// second place to paste the same token.
//
// READ-ONLY. Posting stays where it was — an explicit tool call the operator can see — because
// these endpoints are reachable from a paired phone.

import { ConnectorError, callJson, cap, day, type Row, sub } from "./connectors.http.ts";

const API = "https://slack.com/api";

// Slack answers HTTP 200 for everything, including a revoked token — the real status is `ok`
// and `error` in the body. Nothing upstream can map that for us, so a bad token would otherwise
// surface as an empty channel list: a lie that looks like a working connection with no channels.
const AUTH_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "invalid_token"]);
const SCOPE_ERRORS = new Set(["missing_scope", "not_allowed_token_type", "no_permission", "restricted_action"]);

export function slackError(code: string): ConnectorError {
  if (AUTH_ERRORS.has(code)) return new ConnectorError(401, `Slack rejected that token (${code})`);
  if (SCOPE_ERRORS.has(code)) return new ConnectorError(403, `Slack refused: the bot token is missing a scope (${code})`);
  if (code === "ratelimited") return new ConnectorError(429, "Slack is rate limiting — try again shortly");
  // channel_not_found is a bad argument, not an outage — say so rather than blaming Slack.
  if (code === "channel_not_found" || code === "not_in_channel") return new ConnectorError(404, `Slack: ${code.replace(/_/g, " ")}`);
  return new ConnectorError(502, `Slack said: ${code}`);
}

async function slack(method: string, token: string, params: Record<string, string | number> = {}): Promise<any> {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const qs = q.toString();
  const j = await callJson(`${API}/${method}${qs ? `?${qs}` : ""}`, {
    label: "Slack",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (j?.ok === false) throw slackError(String(j?.error || "unknown_error"));
  return j;
}

/** Which workspace, and as whom. Doubles as the connection check. */
export async function whoami(token: string): Promise<{ team: string; user: string }> {
  const j = await slack("auth.test", token);
  return { team: String(j?.team || ""), user: String(j?.user || "") };
}

/** Shape one channel. Pure, so the row can be tested without a workspace. */
export function toChannel(c: any): Row {
  const members = Number(c?.num_members || 0);
  return {
    id: String(c?.id || ""),
    title: `#${c?.name || "channel"}`,
    sub: sub(members ? `${members} member${members === 1 ? "" : "s"}` : null, c?.is_private ? "private" : null, c?.purpose?.value || null),
  };
}

/** Channels the bot can see, busiest first — the order you'd actually look for one in. */
export async function channels(token: string, limit = 30): Promise<Row[]> {
  const j = await slack("conversations.list", token, {
    types: "public_channel,private_channel",
    exclude_archived: "true",
    limit: cap(limit, 200),
  });
  const list = Array.isArray(j?.channels) ? j.channels : [];
  return list
    .sort((a: any, b: any) => Number(b?.num_members || 0) - Number(a?.num_members || 0))
    .map(toChannel);
}

/** Shape one message. `ts` is epoch seconds as a string, and is also the message's identity. */
export function toMessage(m: any): Row {
  const text = String(m?.text || "").replace(/\s+/g, " ").trim();
  const at = Number(m?.ts);
  return {
    id: String(m?.ts || ""),
    // A message with no text is a file share or a join event, not an empty message — say which.
    title: text || (m?.subtype ? `(${String(m.subtype).replace(/_/g, " ")})` : "(no text)"),
    sub: sub(m?.user ? `<@${m.user}>` : m?.bot_id ? "bot" : null, Number.isFinite(at) && at > 0 ? day(new Date(at * 1000).toISOString()) : null),
  };
}

/** The last things said in one channel. Needs the channel id — `channels()` supplies it. */
export async function messages(token: string, channel: string, limit = 30): Promise<Row[]> {
  if (!channel) throw new ConnectorError(400, "which channel? pick one from Slack channels first");
  const j = await slack("conversations.history", token, { channel, limit: cap(limit, 100) });
  const list = Array.isArray(j?.messages) ? j.messages : [];
  return list.map(toMessage);
}
