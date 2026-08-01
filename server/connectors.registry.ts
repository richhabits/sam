// ─────────────────────────────────────────────────────────────
//  S.A.M. · CONNECTOR REGISTRY — the single source of identity for the services SAM READS.
//
//  A connector is not a provider. PROVIDER_REGISTRY answers "which brains can SAM think with";
//  this answers "which of your own tools can SAM look at". Keeping them apart matters: the
//  provider list is pooled, rotated and cost-routed by models.ts, and none of that is meaningful
//  for a Slack workspace.
//
//  The rule that shaped this file: NO NEW CREDENTIAL VOCABULARY. Every `env` below is a variable
//  SAM already had a place for — SLACK_BOT_TOKEN and NOTION_API_KEY and LINEAR_API_KEY are
//  already offered in Settings' integrations box, VERCEL_TOKEN is already what the yard deploys
//  with, GITHUB_TOKEN is already the GitHub Models provider key. Inventing SAM_SLACK_TOKEN
//  alongside SLACK_BOT_TOKEN is precisely the drift the provider registry exists to prevent.
//  Two of them (Notion, Linear) were saveable but read by nothing at all — a settings field that
//  writes to a variable no code path opens is a promise the app doesn't keep.
//
//  READ-ONLY, all of it, for the same reason server/github.ts is: these are reachable from a
//  paired phone, and listing your channels is a different act from posting in them. Writing to
//  any of these services should be its own granted decision, not a thing that arrives quietly
//  attached to a read feature.
// ─────────────────────────────────────────────────────────────

/** One browsable list a connector offers. `drill` = tapping a row opens another list. */
export interface ConnectorList {
  kind: string;            // url segment: /api/connectors/slack/channels
  label: string;           // shown as the row in the + sheet / the tab in the pane
  hint: string;            // one line under the label
  /** The query param this list accepts to narrow it (`?repo=`, `?channel=`). */
  param?: string;
  /** Useless without that param, so it isn't offered top-level — only reached by drilling. */
  needs?: boolean;
  /** Rows of this list open that kind, passing their id as its `param`. */
  drill?: string;
}

export interface ConnectorSpec {
  id: string;
  label: string;
  /** The env var holding the secret. Always one SAM already knew about. */
  env: string;
  /** Read from the rotating key pool instead of the raw env (GitHub is also a model provider). */
  pooled?: boolean;
  /** The /api/admin/config key that writes `env`, so the UI can send you to the right box. */
  configKey?: string;
  note: string;            // what you get out of connecting it
  url: string;             // where to get the token
  lists: ConnectorList[];
}

export const CONNECTORS: ConnectorSpec[] = [
  {
    id: "github",
    label: "GitHub",
    env: "GITHUB_TOKEN",
    // Shared with the "GitHub Models" provider — one token, one place to paste it.
    pooled: true,
    note: "your repos, and the issues and PRs waiting on you",
    url: "https://github.com/settings/tokens",
    lists: [
      { kind: "repos", label: "GitHub repos", hint: "Yours, most recently pushed first", drill: "issues" },
      // Top-level too: with no repo it answers "what needs me", which is the phone-sized question.
      { kind: "issues", label: "Assigned to you", hint: "Open issues and PRs waiting on you", param: "repo" },
    ],
  },
  {
    id: "slack",
    label: "Slack",
    env: "SLACK_BOT_TOKEN",
    configKey: "slack",
    note: "your channels, and what was said in them recently",
    url: "https://api.slack.com/apps → OAuth & Permissions",
    lists: [
      { kind: "channels", label: "Slack channels", hint: "Where the bot is a member, busiest first", drill: "messages" },
      { kind: "messages", label: "Recent messages", hint: "The last thing said in a channel", param: "channel", needs: true },
    ],
  },
  {
    id: "notion",
    label: "Notion",
    env: "NOTION_API_KEY",
    configKey: "notion",
    note: "the pages and databases you last touched",
    url: "https://www.notion.so/my-integrations",
    lists: [
      { kind: "pages", label: "Notion pages", hint: "Last edited first" },
      { kind: "databases", label: "Notion databases", hint: "Every database shared with the integration" },
    ],
  },
  {
    id: "linear",
    label: "Linear",
    env: "LINEAR_API_KEY",
    configKey: "linear",
    note: "the issues assigned to you, and your teams",
    url: "https://linear.app/settings/api",
    lists: [
      { kind: "issues", label: "Linear issues", hint: "Assigned to you and still open" },
      { kind: "teams", label: "Linear teams", hint: "Every team you belong to" },
    ],
  },
  {
    id: "vercel",
    label: "Vercel",
    env: "VERCEL_TOKEN",
    configKey: "vercel",
    note: "your projects, and whether the last deploy actually succeeded",
    url: "https://vercel.com/account/tokens",
    lists: [
      { kind: "deployments", label: "Vercel deployments", hint: "Newest first — state, target and age" },
      { kind: "projects", label: "Vercel projects", hint: "Everything in the account" },
    ],
  },
];

export function connector(id: string): ConnectorSpec | undefined {
  return CONNECTORS.find((c) => c.id === id);
}

/** The lists a connector offers top-level — the ones that don't need an id to be useful. */
export function topLists(spec: ConnectorSpec): ConnectorList[] {
  return spec.lists.filter((l) => !l.needs);
}
