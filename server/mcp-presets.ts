// ─────────────────────────────────────────────────────────────
//  S.A.M. · MCP PRESETS — one-tap connect to the tools that run a
//  business. Each preset knows how to launch a real MCP server;
//  the user just drops in their key(s) in Settings and SAM gains
//  those tools (always ask-first). Command/args are editable, and
//  each is marked official vs community so nothing is oversold.
//
//  Adding your key writes vault/mcp.json (gitignored) — the keys
//  stay on your machine. Takes effect on the next restart.
// ─────────────────────────────────────────────────────────────

export interface PresetField { env: string; label: string; placeholder?: string }
export interface McpPreset {
  id: string; label: string; emoji: string; note: string;
  official: boolean;             // true = first-party/verified server, false = community (verify the package)
  command: string; args: string[];
  fields: PresetField[];         // secrets → written into the server's env
  docs?: string;
}

// Best-known launch commands. Users can edit command/args if a package name changes.
export const MCP_PRESETS: McpPreset[] = [
  // ── 💰 Business / revenue ──
  { id: "stripe", label: "Stripe", emoji: "💳", official: true, note: "payments, revenue, customers, refunds",
    command: "npx", args: ["-y", "@stripe/mcp", "--tools=all"], fields: [{ env: "STRIPE_SECRET_KEY", label: "Secret key", placeholder: "sk_live_…" }], docs: "https://docs.stripe.com/mcp" },
  { id: "revenuecat", label: "RevenueCat", emoji: "📈", official: true, note: "subscription revenue, MRR, churn (in-app purchases)",
    command: "npx", args: ["-y", "@revenuecat/mcp"], fields: [{ env: "REVENUECAT_API_KEY", label: "API key (v2)", placeholder: "sk_…" }], docs: "https://www.revenuecat.com/docs/tools/mcp" },

  // ── 📣 Marketing / social / ads ──
  { id: "metricool", label: "Metricool", emoji: "📊", official: true, note: "schedule & POST to all your socials in one shot, analytics",
    command: "uvx", args: ["mcp-metricool"], fields: [{ env: "METRICOOL_USER_TOKEN", label: "User token" }, { env: "METRICOOL_USER_ID", label: "User ID" }], docs: "https://github.com/metricool/mcp-metricool" },
  { id: "meta_ads", label: "Meta Ads", emoji: "📣", official: false, note: "run & manage Facebook/Instagram ad campaigns",
    command: "uvx", args: ["meta-ads-mcp"], fields: [{ env: "META_ACCESS_TOKEN", label: "Access token" }], docs: "https://github.com/pipeboard-co/meta-ads-mcp" },
  { id: "buffer", label: "Buffer (community)", emoji: "🅱️", official: false, note: "queue posts across social platforms",
    command: "npx", args: ["-y", "buffer-mcp-server"], fields: [{ env: "BUFFER_ACCESS_TOKEN", label: "Access token" }], docs: "https://buffer.com/developers" },

  // ── 🗂️ Workspace / data ──
  { id: "notion", label: "Notion", emoji: "📝", official: true, note: "read/write your Notion workspace",
    command: "npx", args: ["-y", "@notionhq/notion-mcp-server"], fields: [{ env: "NOTION_TOKEN", label: "Integration token", placeholder: "ntn_…" }], docs: "https://github.com/makenotion/notion-mcp-server" },
  { id: "supabase", label: "Supabase", emoji: "🐘", official: true, note: "query & manage your Supabase database",
    command: "npx", args: ["-y", "@supabase/mcp-server-supabase@latest"], fields: [{ env: "SUPABASE_ACCESS_TOKEN", label: "Access token", placeholder: "sbp_…" }], docs: "https://github.com/supabase-community/supabase-mcp" },
  { id: "github", label: "GitHub", emoji: "🐙", official: true, note: "repos, issues, PRs, code search",
    command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], fields: [{ env: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Personal access token", placeholder: "ghp_…" }], docs: "https://github.com/modelcontextprotocol/servers" },
  { id: "slack", label: "Slack", emoji: "💬", official: true, note: "read & post to your Slack workspace",
    command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], fields: [{ env: "SLACK_BOT_TOKEN", label: "Bot token", placeholder: "xoxb-…" }, { env: "SLACK_TEAM_ID", label: "Team ID" }], docs: "https://github.com/modelcontextprotocol/servers" },
  { id: "brave", label: "Brave Search", emoji: "🦁", official: true, note: "independent web search (extra source for research)",
    command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"], fields: [{ env: "BRAVE_API_KEY", label: "API key" }], docs: "https://github.com/modelcontextprotocol/servers" },

  // ── 🧠 Agent infra ──
  { id: "headroom", label: "Headroom (compression)", emoji: "🗜️", official: true, note: "compress context 60-95% — the full engine (SmartCrusher/AST), on top of SAM built-in",
    command: "npx", args: ["-y", "headroom-ai", "mcp"], fields: [], docs: "https://github.com/headroomlabs-ai/headroom" },

  // ── 🛒 Commerce / growth ──
  { id: "shopify", label: "Shopify", emoji: "🛒", official: true, note: "products, orders, storefront — run your shop",
    command: "npx", args: ["-y", "@shopify/dev-mcp"], fields: [{ env: "SHOPIFY_ACCESS_TOKEN", label: "Admin API token", placeholder: "shpat_…" }, { env: "SHOPIFY_STORE", label: "Store (my-shop.myshopify.com)" }], docs: "https://shopify.dev/docs/apps/build/storefront-mcp" },
  { id: "google_ads", label: "Google Ads", emoji: "🅶", official: false, note: "search/display ad campaigns & performance",
    command: "uvx", args: ["google-ads-mcp"], fields: [{ env: "GOOGLE_ADS_DEVELOPER_TOKEN", label: "Developer token" }, { env: "GOOGLE_ADS_CLIENT_ID", label: "OAuth client ID" }], docs: "https://developers.google.com/google-ads/api/docs/start" },
  { id: "google_analytics", label: "Google Analytics", emoji: "📉", official: false, note: "traffic, conversions, GA4 reports",
    command: "uvx", args: ["mcp-google-analytics"], fields: [{ env: "GA_PROPERTY_ID", label: "GA4 property ID" }, { env: "GOOGLE_APPLICATION_CREDENTIALS", label: "Service-account JSON path" }], docs: "https://developers.google.com/analytics" },
  { id: "mailchimp", label: "Mailchimp", emoji: "🐵", official: false, note: "email lists, campaigns, audiences",
    command: "npx", args: ["-y", "mailchimp-mcp"], fields: [{ env: "MAILCHIMP_API_KEY", label: "API key" }], docs: "https://mailchimp.com/developer/" },
  { id: "airtable", label: "Airtable", emoji: "🗃️", official: true, note: "your bases as a flexible database",
    command: "npx", args: ["-y", "airtable-mcp-server"], fields: [{ env: "AIRTABLE_API_KEY", label: "Personal access token", placeholder: "pat…" }], docs: "https://github.com/domdomegg/airtable-mcp-server" },
  { id: "linear", label: "Linear", emoji: "📐", official: true, note: "issues, projects, product roadmap",
    command: "npx", args: ["-y", "mcp-remote", "https://mcp.linear.app/sse"], fields: [{ env: "LINEAR_API_KEY", label: "API key", placeholder: "lin_api_…" }], docs: "https://linear.app/developers" },
];

export function presetById(id: string): McpPreset | undefined {
  return MCP_PRESETS.find((p) => p.id === id);
}
